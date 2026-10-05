import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asWorker, asManager, asAppAnon } from './setup';
import type { Tx } from '@/db/client';
import { hashToken } from '@/lib/auth/token';
import {
  issueWorkerLoginCode, redeemWorkerLoginCode, workerBySession, endWorkerSession, endWorkerSessions,
  LOGIN_CODE_MINUTES, loginCodeState, endManagerSessionByToken,
} from '@/lib/auth/workerSession';
import { archiveWorker, issueToken, restoreWorker } from '@/app/(manager)/workers/operations';
import { chatOf, linkWorkerChat } from './loginFixtures';
import { telegramOwner, unlink } from '@/lib/telegram/links';

let ian: string; let pol: string;

beforeEach(async () => {
  await resetTestDb();
  [{ id: ian }] = await testSql`insert into worker (full_name, name_key) values ('Ян', 'ян') returning id`;
  [{ id: pol }] = await testSql`insert into worker (full_name, name_key) values ('Полина', 'полина') returning id`;
  await linkWorkerChat(ian);
  await linkWorkerChat(pol);
});

/** Код выдан «давно»: лимит выдачи (30 с) уже не мешает следующей. */
const age = (seconds: number) => testSql`update worker_login_code set created_at = created_at - make_interval(secs => ${seconds})`;

describe('код входа из бота', () => {
  it('выдача работнику → вход без личности → сессия работника; код одноразовый', async () => {
    const code = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian)));
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const session = await asAppAnon((tx) => redeemWorkerLoginCode(tx, code ?? ''));
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await asAppAnon((tx) => workerBySession(tx, session ?? ''))).toEqual({ id: ian, fullName: 'Ян' });
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, code ?? ''))).toBeNull();
    expect(await testSql`select 1 from worker_session`).toHaveLength(1);
  });

  it('в базе только хеши: ни код, ни токен сессии не хранятся', async () => {
    const code = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    const session = await asAppAnon((tx) => redeemWorkerLoginCode(tx, code)) ?? '';
    const [c] = await testSql`select code_hash from worker_login_code`;
    const [s] = await testSql`select token_hash from worker_session`;
    expect(c.code_hash).toBe(hashToken(code));
    expect(s.token_hash).toBe(hashToken(session));
    await expect(testSql`insert into worker_session (token_hash, worker_id, chat_id, expires_at) values ('raw', ${ian}, 1, now())`)
      .rejects.toThrow(/check/);
  });

  it(`срок кода — ${LOGIN_CODE_MINUTES} минут по часам базы; истёкший не действует`, async () => {
    const code = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    const [row] = await testSql`select extract(epoch from expires_at - now())::int as left from worker_login_code`;
    expect(row.left).toBeGreaterThanOrEqual(LOGIN_CODE_MINUTES * 60 - 5);
    expect(row.left).toBeLessThanOrEqual(LOGIN_CODE_MINUTES * 60);
    await testSql`update worker_login_code set expires_at = now() - interval '1 second'`;
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, code))).toBeNull();
    expect(await testSql`select 1 from worker_session`).toEqual([]);
  });

  it('сессия — на год', async () => {
    const code = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    await asAppAnon((tx) => redeemWorkerLoginCode(tx, code));
    const [row] = await testSql`select abs(extract(epoch from expires_at - (now() + interval '1 year')))::int as off
      from worker_session`;
    expect(row.off).toBeLessThanOrEqual(5);
  });

  it('новая выдача гасит прежний код того же работника, чужие не трогает', async () => {
    const a = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    const p = await asWorker(pol, (tx) => issueWorkerLoginCode(tx, chatOf(pol))) ?? '';
    await age(31);
    const b = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, a))).toBeNull();
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, b))).not.toBeNull();
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, p))).not.toBeNull();
  });

  it('не чаще раза в 30 секунд на работника: повтор — null, прежний код остаётся', async () => {
    const a = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    expect(await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian)))).toBeNull();
    // Лимит — на работника: другой получает код сразу.
    expect(await asWorker(pol, (tx) => issueWorkerLoginCode(tx, chatOf(pol)))).not.toBeNull();
    await age(29);
    expect(await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian)))).toBeNull();
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, a))).not.toBeNull();
    // Использованный код тоже считается выдачей.
    expect(await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian)))).toBeNull();
    await age(2);
    expect(await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian)))).not.toBeNull();
  });

  it('одновременные выдачи одному работнику — один код', async () => {
    const codes = await Promise.all([1, 2, 3].map(() => asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian)))));
    expect(codes.filter((c) => c !== null)).toHaveLength(1);
    expect(await testSql`select 1 from worker_login_code`).toHaveLength(1);
  });

  it('одновременный вход по одному коду — одна сессия', async () => {
    const code = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    const sessions = await Promise.all([1, 2, 3].map(() => asAppAnon((tx) => redeemWorkerLoginCode(tx, code))));
    expect(sessions.filter((s) => s !== null)).toHaveLength(1);
    expect(await testSql`select 1 from worker_session`).toHaveLength(1);
  });

  it('менеджер и сессия без личности кода не получают', async () => {
    await expect(asManager((tx) => issueWorkerLoginCode(tx, 1))).rejects.toThrow(/permission denied/);
    await expect(asAppAnon((tx) => issueWorkerLoginCode(tx, 1))).rejects.toThrow(/permission denied/);
    expect(await testSql`select 1 from worker_login_code`).toEqual([]);
  });

  it('архивный работник: код не выдаётся, выданный не действует', async () => {
    const code = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    await testSql`update worker set status = 'archived' where id = ${ian}`;
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, code))).toBeNull();
    expect(await testSql`select 1 from worker_session`).toEqual([]);
    await expect(asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian)))).rejects.toThrow(/permission denied/);
  });

  it('вход — только из сессии без личности: работник и менеджер получают null, код не гасится', async () => {
    const code = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    expect(await asWorker(pol, (tx) => redeemWorkerLoginCode(tx, code))).toBeNull();
    expect(await asManager((tx) => redeemWorkerLoginCode(tx, code))).toBeNull();
    expect(await testSql`select 1 from worker_session`).toEqual([]);
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, code))).not.toBeNull();
  });

  it('неверный код — null', async () => {
    await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian)));
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, 'чужой'))).toBeNull();
  });
});

describe('сессия работника', () => {
  async function login(workerId: string): Promise<string> {
    const code = await asWorker(workerId, (tx) => issueWorkerLoginCode(tx, chatOf(workerId))) ?? '';
    await age(31);
    return await asAppAnon((tx) => redeemWorkerLoginCode(tx, code)) ?? '';
  }

  it('истёкшая сессия и сессия архивного работника не действуют', async () => {
    const a = await login(ian);
    const b = await login(pol);
    await testSql`update worker_session set expires_at = now() - interval '1 second' where worker_id = ${ian}`;
    expect(await asAppAnon((tx) => workerBySession(tx, a))).toBeNull();
    await testSql`update worker set status = 'archived' where id = ${pol}`;
    expect(await asAppAnon((tx) => workerBySession(tx, b))).toBeNull();
    expect(await asAppAnon((tx) => workerBySession(tx, 'чужой'))).toBeNull();
  });

  it('выход удаляет только свою сессию', async () => {
    const a = await login(ian);
    const b = await login(ian);
    await asAppAnon((tx) => endWorkerSession(tx, a));
    expect(await asAppAnon((tx) => workerBySession(tx, a))).toBeNull();
    expect(await asAppAnon((tx) => workerBySession(tx, b))).toEqual({ id: ian, fullName: 'Ян' });
  });

  it('закрыть все сессии и коды работника может только менеджер', async () => {
    const a = await login(ian);
    const p = await login(pol);
    await testSql`update worker_login_code set created_at = now() - interval '1 minute'`;
    const pending = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    await expect(asWorker(ian, (tx) => endWorkerSessions(tx, pol))).rejects.toThrow(/permission denied/);
    await expect(asAppAnon((tx) => endWorkerSessions(tx, pol))).rejects.toThrow(/permission denied/);
    await asManager((tx) => endWorkerSessions(tx, ian));
    expect(await asAppAnon((tx) => workerBySession(tx, a))).toBeNull();
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, pending))).toBeNull();
    expect(await asAppAnon((tx) => workerBySession(tx, p))).toEqual({ id: pol, fullName: 'Полина' });
  });
});

describe('права', () => {
  it('app_user не читает и не пишет таблицы кодов и сессий напрямую', async () => {
    const roles: Array<(fn: (tx: Tx) => Promise<unknown>) => Promise<unknown>> = [
      asAppAnon, asManager, (fn) => asWorker(ian, fn),
    ];
    for (const run of roles) {
      for (const table of ['worker_login_code', 'worker_session']) {
        await expect(run((tx) => tx.unsafe(`select * from ${table}`))).rejects.toThrow(/permission denied/);
        await expect(run((tx) => tx.unsafe(`delete from ${table}`))).rejects.toThrow(/permission denied/);
      }
      await expect(run((tx) => tx`insert into worker_session (token_hash, worker_id, expires_at)
        values (${hashToken('x')}, ${ian}, '9999-01-01')`)).rejects.toThrow(/permission denied/);
      await expect(run((tx) => tx`insert into worker_login_code (code_hash, worker_id, expires_at)
        values (${hashToken('x')}, ${ian}, '9999-01-01')`)).rejects.toThrow(/permission denied/);
    }
  });

  it('функции: исполняет app_user, PUBLIC — нет; search_path зафиксирован; security definer', async () => {
    const names = ['end_manager_session', 'end_worker_session', 'end_worker_sessions', 'issue_worker_login_code',
      'redeem_worker_login_code', 'webapp_login', 'worker_by_session', 'worker_login_code_state'];
    const rows = await testSql`
      select p.proname, p.prosecdef as definer,
             has_function_privilege('app_user', p.oid, 'execute') as app_user,
             exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
                     where grantee = 0 and privilege_type = 'EXECUTE') as public,
             'search_path=public, pg_temp' = any(p.proconfig) as path
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ${testSql(names)}
      order by p.proname`;
    expect(rows).toEqual(names.map((proname) => ({ proname, definer: true, app_user: true, public: false, path: true })));
  });

  it('anon и authenticated не исполняют функции и не видят таблицы', async () => {
    const roles = await testSql`select rolname from pg_roles where rolname in ('anon', 'authenticated')`;
    for (const { rolname } of roles) {
      for (const query of [
        `select issue_worker_login_code('${'0'.repeat(64)}', 1)`,
        `select redeem_worker_login_code('${'0'.repeat(64)}', '${'1'.repeat(64)}')`,
        `select * from worker_login_code_state('${'0'.repeat(64)}')`,
        `select end_manager_session('${'0'.repeat(64)}')`,
        `select webapp_login('${'0'.repeat(64)}', 1, now(), '${'1'.repeat(64)}', null)`,
        'select * from telegram_webapp_login',
        `select * from worker_by_session('${'0'.repeat(64)}')`,
        `select end_worker_session('${'0'.repeat(64)}')`,
        `select end_worker_sessions('${ian}')`,
        'select * from worker_login_code',
        'select * from worker_session',
      ]) {
        await expect(testSql.begin(async (tx) => {
          await tx.unsafe(`set local role ${rolname}`);
          return tx.unsafe(query);
        })).rejects.toThrow(/permission denied/);
      }
    }
  });

  it('RLS на обеих таблицах включён', async () => {
    const rows = await testSql`select relname, relrowsecurity from pg_class
      where oid in ('worker_login_code'::regclass, 'worker_session'::regclass) order by relname`;
    expect(rows).toEqual([
      { relname: 'worker_login_code', relrowsecurity: true },
      { relname: 'worker_session', relrowsecurity: true },
    ]);
  });
});

describe('перевыпуск личной ссылки и архив гасят сессии и коды', () => {
  async function loginWithPending(workerId: string): Promise<{ session: string; pending: string }> {
    const code = await asWorker(workerId, (tx) => issueWorkerLoginCode(tx, chatOf(workerId))) ?? '';
    const session = await asAppAnon((tx) => redeemWorkerLoginCode(tx, code)) ?? '';
    await age(31);
    const pending = await asWorker(workerId, (tx) => issueWorkerLoginCode(tx, chatOf(workerId))) ?? '';
    return { session, pending };
  }

  it('issueToken', async () => {
    const mine = await loginWithPending(ian);
    const other = await loginWithPending(pol);
    await asManager((tx) => issueToken(tx, ian));
    expect(await asAppAnon((tx) => workerBySession(tx, mine.session))).toBeNull();
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, mine.pending))).toBeNull();
    expect(await asAppAnon((tx) => workerBySession(tx, other.session))).toEqual({ id: pol, fullName: 'Полина' });
  });

  it('archiveWorker', async () => {
    const mine = await loginWithPending(ian);
    await asManager((tx) => archiveWorker(tx, ian));
    await asManager((tx) => restoreWorker(tx, ian));
    expect(await asAppAnon((tx) => workerBySession(tx, mine.session))).toBeNull();
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, mine.pending))).toBeNull();
    expect(await testSql`select 1 from worker_session where worker_id = ${ian}`).toEqual([]);
    expect(await testSql`select 1 from worker_login_code where worker_id = ${ian}`).toEqual([]);
  });
});

describe('чат кода и сессии: отключение Telegram закрывает вход через него (M1, L8)', () => {
  const login = async (workerId: string): Promise<string> => {
    const code = await asWorker(workerId, (tx) => issueWorkerLoginCode(tx, chatOf(workerId))) ?? '';
    await age(31);
    return await asAppAnon((tx) => redeemWorkerLoginCode(tx, code)) ?? '';
  };

  it('без чата, в чужой или неподключённый чат код не выдаётся', async () => {
    await expect(asWorker(ian, (tx) => tx`select issue_worker_login_code(${hashToken('x')}, null)`))
      .rejects.toThrow(/permission denied/);
    await expect(asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(pol)))).rejects.toThrow(/permission denied/);
    await expect(asWorker(ian, (tx) => issueWorkerLoginCode(tx, 99))).rejects.toThrow(/permission denied/);
    expect(await testSql`select 1 from worker_login_code`).toEqual([]);
    const [{ defaults }] = await testSql`select pronargdefaults as defaults from pg_proc where proname = 'issue_worker_login_code'`;
    expect(defaults).toBe(0);
  });

  it('код и сессия помнят чат', async () => {
    const session = await login(ian);
    expect(await testSql`select chat_id from worker_session where token_hash = ${hashToken(session)}`)
      .toEqual([{ chat_id: String(chatOf(ian)) }]);
  });

  it('«Отключить» гасит коды и сессии из этого чата, кроме сессии этого браузера; чужие не трогает', async () => {
    const here = await login(ian);
    const other = await login(ian);
    const polSession = await login(pol);
    const pending = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    await asWorker(ian, (tx) => unlink(tx, ian, here));
    expect(await asAppAnon((tx) => workerBySession(tx, here))).toEqual({ id: ian, fullName: 'Ян' });
    expect(await asAppAnon((tx) => workerBySession(tx, other))).toBeNull();
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, pending))).toBeNull();
    expect(await asAppAnon((tx) => workerBySession(tx, polSession))).toEqual({ id: pol, fullName: 'Полина' });
  });

  it('отключение без сессии этого браузера закрывает все сессии чата', async () => {
    const a = await login(ian);
    await asWorker(ian, (tx) => unlink(tx, ian));
    expect(await asAppAnon((tx) => workerBySession(tx, a))).toBeNull();
  });

  it('вход по коду проверяет, что чат кода всё ещё подключён к работнику', async () => {
    const code = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    // Прямая правка в обход триггера удаления: проверка — в самой redeem_worker_login_code.
    await testSql`update telegram_link set chat_id = 4242 where worker_id = ${ian}`;
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, code))).toBeNull();
    expect(await testSql`select 1 from worker_session`).toEqual([]);
  });

  it('привязка чата к другому работнику закрывает вход прежнего владельца через этот чат', async () => {
    const a = await login(ian);
    await testSql`delete from telegram_link where worker_id = ${ian}`;
    expect(await asAppAnon((tx) => workerBySession(tx, a))).toBeNull();
  });
});

describe('состояние кода для подтверждения входа (L3, L4)', () => {
  it('действующий — с именем; использованный, истёкший и с отключённым чатом — без имени', async () => {
    const code = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    expect(await asAppAnon((tx) => loginCodeState(tx, code))).toEqual({ state: 'valid', fullName: 'Ян' });
    // Проверка состояния код не гасит.
    expect(await testSql`select used_at from worker_login_code`).toEqual([{ used_at: null }]);
    await asAppAnon((tx) => redeemWorkerLoginCode(tx, code));
    expect(await asAppAnon((tx) => loginCodeState(tx, code))).toEqual({ state: 'used', fullName: null });
    expect(await asAppAnon((tx) => loginCodeState(tx, 'чужой'))).toEqual({ state: 'invalid', fullName: null });

    const late = await asWorker(pol, (tx) => issueWorkerLoginCode(tx, chatOf(pol))) ?? '';
    await testSql`update worker_login_code set expires_at = now() - interval '1 second' where worker_id = ${pol}`;
    expect(await asAppAnon((tx) => loginCodeState(tx, late))).toEqual({ state: 'expired', fullName: null });

    await age(31);
    const unlinked = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
    await testSql`update telegram_link set chat_id = 4243 where worker_id = ${ian}`;
    expect(await asAppAnon((tx) => loginCodeState(tx, unlinked))).toEqual({ state: 'invalid', fullName: null });
  });

  it('end_manager_session удаляет только сессию с этим токеном', async () => {
    await testSql`insert into manager_session (token_hash, expires_at) values
      (${hashToken('a')}, now() + interval '1 hour'), (${hashToken('b')}, now() + interval '1 hour')`;
    await asAppAnon((tx) => endManagerSessionByToken(tx, 'a'));
    expect(await testSql`select token_hash from manager_session`).toEqual([{ token_hash: hashToken('b') }]);
  });
});

describe('восстановление из архива не возвращает вход из бота (L2)', () => {
  it('архив отключает Telegram работника', async () => {
    await asManager((tx) => archiveWorker(tx, ian));
    await asManager((tx) => restoreWorker(tx, ian));
    expect(await testSql`select 1 from telegram_link where worker_id = ${ian}`).toEqual([]);
    expect(await asAppAnon((tx) => telegramOwner(tx, chatOf(ian)))).toBeNull();
    await expect(asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian)))).rejects.toThrow(/permission denied/);
    expect(await testSql`select 1 from telegram_link where worker_id = ${pol}`).toHaveLength(1);
  });
});
