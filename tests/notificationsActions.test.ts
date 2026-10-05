import { beforeEach, expect, it, vi } from 'vitest';
import type { Tx } from '@/db/client';
import { asAppAnon, asWorker, resetTestDb, testSql } from './setup';
import { issueWorkerLoginCode, redeemWorkerLoginCode, workerBySession } from '@/lib/auth/workerSession';
import { chatOf, linkWorkerChat } from './loginFixtures';

// «Отключить» на /notifications целиком: cookie — из jar, база — тестовая под ролью приложения.
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => { jar.set(name, value); },
    delete: (c: string | { name: string }) => { jar.delete(typeof c === 'string' ? c : c.name); },
  }),
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/db/client', async () => {
  const setup = await import('./setup');
  return {
    withAnon: <T>(fn: (tx: Tx) => Promise<T>) => setup.asAppAnon(fn),
    withManager: <T>(fn: (tx: Tx) => Promise<T>) => setup.asManager(fn),
    withWorker: <T>(id: string, fn: (tx: Tx) => Promise<T>) => setup.asWorker(id, fn),
  };
});
const { disconnectTelegramAction } = await import('@/app/(worker)/notifications/actions');

let ian: string;
beforeEach(async () => {
  await resetTestDb();
  jar.clear();
  [{ id: ian }] = await testSql`insert into worker (full_name, name_key) values ('Ян', 'ян') returning id`;
  await linkWorkerChat(ian);
});

async function botSession(): Promise<string> {
  const code = await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian))) ?? '';
  await testSql`update worker_login_code set created_at = created_at - interval '1 minute'`;
  return await asAppAnon((tx) => redeemWorkerLoginCode(tx, code)) ?? '';
}

it('«Отключить» закрывает вход через этот чат на других устройствах, но не в этом браузере (M1)', async () => {
  const here = await botSession();
  const elsewhere = await botSession();
  jar.set('worker_session', here);
  expect(await disconnectTelegramAction()).toEqual({ error: null });
  expect(await testSql`select 1 from telegram_link`).toEqual([]);
  expect(await asAppAnon((tx) => workerBySession(tx, here))).toEqual({ id: ian, fullName: 'Ян' });
  expect(await asAppAnon((tx) => workerBySession(tx, elsewhere))).toBeNull();
});
