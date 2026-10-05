import { beforeEach, expect, it } from 'vitest';
import { asAppAnon, asManager, asWorker, resetTestDb, testSql } from './setup';
import { hashToken } from '@/lib/auth/token';
import { issueWorkerLoginCode, redeemWorkerLoginCode, workerBySession } from '@/lib/auth/workerSession';
import { archiveWorker, restoreWorker } from '@/app/(manager)/workers/operations';
import { chatOf, linkWorkerChat } from './loginFixtures';
import { unlink } from '@/lib/telegram/links';

beforeEach(() => resetTestDb());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
it.each([null, hashToken('личная ссылка')])('вход ждёт архивирования, код отзывается без взаимной блокировки (token_hash=%s)', async tokenHash => {
  const [worker] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key,token_hash)
    values ('Работник','работник',${tokenHash}) returning id`;
  await linkWorkerChat(worker.id);
  const code = await asWorker(worker.id, tx => issueWorkerLoginCode(tx, chatOf(worker.id))) ?? '';
  const ready = deferred<number>(), secondPid = deferred<number>(), barrier = deferred<void>();
  const revoke = asManager(async tx => {
    // Первая часть настоящей archiveWorker, пауза до удаления кодов/сессий.
    await tx`update worker set status='archived',token_hash=null,token_issued_at=null where id=${worker.id}`;
    const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    ready.resolve(row.pid);
    await barrier.promise;
    await archiveWorker(tx, worker.id);
  });
  const firstPid = await ready.promise;
  const redeem = asAppAnon(async tx => {
    const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    secondPid.resolve(row.pid);
    return redeemWorkerLoginCode(tx, code);
  });
  const finished = Promise.all([revoke, redeem]);
  void finished.catch(() => {});
  try {
    const pid = await secondPid.promise;
    await expect.poll(async () => {
      const [row] = await testSql<{ blocked: boolean }[]>`select ${firstPid}=any(pg_blocking_pids(${pid})) as blocked`;
      return row.blocked;
    }, { timeout: 3000 }).toBe(true);
  } finally { barrier.resolve(); }
  const [, session] = await finished;
  expect(session).toBeNull();
  await asManager(tx => restoreWorker(tx, worker.id));
  expect(await testSql`select 1 from worker_session where worker_id=${worker.id}`).toEqual([]);
  expect(await asAppAnon(tx => redeemWorkerLoginCode(tx, code))).toBeNull();
});

it('архивирование после начатого входа закрывает его сессию и после восстановления', async () => {
  const [worker] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key) values ('Работник','работник') returning id`;
  await linkWorkerChat(worker.id);
  const code = await asWorker(worker.id, tx => issueWorkerLoginCode(tx, chatOf(worker.id))) ?? '';
  const ready = deferred<string>(), barrier = deferred<void>();
  const redeem = asAppAnon(async tx => {
    const session = await redeemWorkerLoginCode(tx, code) ?? '';
    ready.resolve(session);
    await barrier.promise;
    return session;
  });
  const session = await ready.promise;
  const revoke = asManager(tx => archiveWorker(tx, worker.id));
  barrier.resolve();
  await Promise.all([redeem, revoke]);
  await asManager(tx => restoreWorker(tx, worker.id));
  expect(await asAppAnon(tx => workerBySession(tx, session))).toBeNull();
  expect(await testSql`select 1 from worker_session where worker_id=${worker.id}`).toEqual([]);
});

/** Ждёт, пока сессия `pid` не встанет в ожидание блокировки. */
async function waitBlocked(pid: number): Promise<void> {
  await expect.poll(async () => {
    const [row] = await testSql<{ waiting: boolean }[]>`select cardinality(pg_blocking_pids(${pid})) > 0 as waiting`;
    return row.waiting;
  }, { timeout: 3000 }).toBe(true);
}

it('отключение Telegram во время выдачи кода гасит и этот код (M1)', async () => {
  const [worker] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key) values ('Работник','работник') returning id`;
  await linkWorkerChat(worker.id);
  const issued = deferred<string>(), barrier = deferred<void>(), unlinkPid = deferred<number>();
  const issue = asWorker(worker.id, async tx => {
    const code = await issueWorkerLoginCode(tx, chatOf(worker.id)) ?? '';
    issued.resolve(code);
    await barrier.promise;
    return code;
  });
  const code = await issued.promise;
  const disconnect = asWorker(worker.id, async tx => {
    const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    unlinkPid.resolve(row.pid);
    await unlink(tx, worker.id);
  });
  const finished = Promise.all([issue, disconnect]);
  void finished.catch(() => {});
  try { await waitBlocked(await unlinkPid.promise); } finally { barrier.resolve(); }
  await finished;
  expect(await asAppAnon(tx => redeemWorkerLoginCode(tx, code))).toBeNull();
  expect(await testSql`select 1 from worker_login_code where worker_id=${worker.id}`).toEqual([]);
});

it('вход по коду во время отключения Telegram: сессия закрывается без взаимной блокировки (M1)', async () => {
  const [worker] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key) values ('Работник','работник') returning id`;
  await linkWorkerChat(worker.id);
  const code = await asWorker(worker.id, tx => issueWorkerLoginCode(tx, chatOf(worker.id))) ?? '';
  const redeemed = deferred<string>(), barrier = deferred<void>(), unlinkPid = deferred<number>();
  const redeem = asAppAnon(async tx => {
    const session = await redeemWorkerLoginCode(tx, code) ?? '';
    redeemed.resolve(session);
    await barrier.promise;
    return session;
  });
  const session = await redeemed.promise;
  expect(session).not.toBe('');
  const disconnect = asWorker(worker.id, async tx => {
    const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    unlinkPid.resolve(row.pid);
    await unlink(tx, worker.id);
  });
  const finished = Promise.all([redeem, disconnect]);
  void finished.catch(() => {});
  try { await waitBlocked(await unlinkPid.promise); } finally { barrier.resolve(); }
  await finished;
  expect(await asAppAnon(tx => workerBySession(tx, session))).toBeNull();
});
