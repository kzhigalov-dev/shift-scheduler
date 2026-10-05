import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asWorker, asManager, asAppAnon } from './setup';
import { hashToken } from '@/lib/auth/token';
import {
  AlreadyConnectedError, feedWorkerId, hasManagerFeed, hasWorkerFeed, isManagerFeed, issueManagerFeed, issueWorkerFeed,
  managerFeedPath, workerFeedPath,
} from '@/lib/calendar/feedKeys';

let alice: string; let bob: string;

beforeEach(async () => {
  await resetTestDb();
  [{ id: alice }] = await testSql`insert into worker (full_name, name_key) values ('Алиса', 'алиса') returning id`;
  [{ id: bob }] = await testSql`insert into worker (full_name, name_key) values ('Боб', 'боб') returning id`;
});

describe('ключи подписки', () => {
  it('работник выдаёт себе ключ; новый отзывает старый', async () => {
    const first = await asWorker(alice, (tx) => issueWorkerFeed(tx, alice, true));
    expect(await asAppAnon((tx) => feedWorkerId(tx, `${first}.ics`))).toBe(alice);
    const second = await asWorker(alice, (tx) => issueWorkerFeed(tx, alice, true));
    expect(await asAppAnon((tx) => feedWorkerId(tx, first))).toBeNull();
    expect(await asAppAnon((tx) => feedWorkerId(tx, second))).toBe(alice);
    expect(await asWorker(alice, (tx) => hasWorkerFeed(tx, alice))).toBe(true);
    expect(await asWorker(bob, (tx) => hasWorkerFeed(tx, bob))).toBe(false);
  });

  it('в базе только хеш', async () => {
    const token = await asWorker(alice, (tx) => issueWorkerFeed(tx, alice, true));
    const rows = await testSql`select token_hash from calendar_feed`;
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toHaveLength(64);
    expect(rows[0].token_hash).toBe(hashToken(token));
  });

  it('работник не видит и не трогает чужие ключи', async () => {
    await asWorker(bob, (tx) => issueWorkerFeed(tx, bob, true));
    const seen = await asWorker(alice, (tx) => tx`select worker_id from calendar_feed`);
    expect(seen).toEqual([]);
    await expect(asWorker(alice, (tx) => issueWorkerFeed(tx, bob, true))).rejects.toThrow(/row-level security/);
  });

  it('работник не может вставить ключ менеджера (worker_id = null)', async () => {
    await expect(asWorker(alice, (tx) => tx`insert into calendar_feed (worker_id, token_hash) values (null, ${hashToken('x')})`))
      .rejects.toThrow(/row-level security/);
  });

  it('работник не видит ключ менеджера', async () => {
    await asManager((tx) => issueManagerFeed(tx, true));
    const seen = await asWorker(alice, (tx) => tx`select worker_id from calendar_feed`);
    expect(seen).toEqual([]);
  });

  it('архивный работник — ключ не действует', async () => {
    const token = await asWorker(alice, (tx) => issueWorkerFeed(tx, alice, true));
    await testSql`update worker set status = 'archived' where id = ${alice}`;
    expect(await asAppAnon((tx) => feedWorkerId(tx, token))).toBeNull();
  });

  it('ключ менеджера', async () => {
    expect(await asManager((tx) => hasManagerFeed(tx))).toBe(false);
    const token = await asManager((tx) => issueManagerFeed(tx, true));
    expect(await asAppAnon((tx) => isManagerFeed(tx, `${token}.ics`))).toBe(true);
    expect(await asAppAnon((tx) => isManagerFeed(tx, 'чужой'))).toBe(false);
    const again = await asManager((tx) => issueManagerFeed(tx, true));
    expect(await asAppAnon((tx) => isManagerFeed(tx, token))).toBe(false);
    expect(await asAppAnon((tx) => isManagerFeed(tx, again))).toBe(true);
    // ключ работника — не ключ менеджера
    const w = await asWorker(alice, (tx) => issueWorkerFeed(tx, alice, true));
    expect(await asAppAnon((tx) => isManagerFeed(tx, w))).toBe(false);
  });

  it('без replace существующий ключ не заменяется — UserError, старый ключ жив', async () => {
    const first = await asWorker(alice, (tx) => issueWorkerFeed(tx, alice, false));
    await expect(asWorker(alice, (tx) => issueWorkerFeed(tx, alice, false))).rejects.toBeInstanceOf(AlreadyConnectedError);
    expect(await asAppAnon((tx) => feedWorkerId(tx, first))).toBe(alice);
    const second = await asWorker(alice, (tx) => issueWorkerFeed(tx, alice, true));
    expect(await asAppAnon((tx) => feedWorkerId(tx, first))).toBeNull();
    expect(await asAppAnon((tx) => feedWorkerId(tx, second))).toBe(alice);
  });

  it('ключ менеджера без replace — то же правило', async () => {
    const first = await asManager((tx) => issueManagerFeed(tx, false));
    await expect(asManager((tx) => issueManagerFeed(tx, false))).rejects.toThrow('Календарь уже подключён');
    expect(await asAppAnon((tx) => isManagerFeed(tx, first))).toBe(true);
  });

  it('app_user не может менять ключи: только вставка и удаление', async () => {
    await asWorker(alice, (tx) => issueWorkerFeed(tx, alice, true));
    await expect(asWorker(alice, (tx) => tx`update calendar_feed set token_hash = 'x' where worker_id = ${alice}`))
      .rejects.toThrow(/permission denied/);
  });

  it('пути', () => {
    expect(workerFeedPath('abc')).toBe('/cal/abc.ics');
    expect(managerFeedPath('abc')).toBe('/cal/m/abc.ics');
  });
});
