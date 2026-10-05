import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { scryptSync, randomBytes } from 'node:crypto';
import type { Tx } from '@/db/client';
import { resetTestDb, testSql } from './setup';
import { loginIpHash } from '@/lib/auth/loginThrottle';

// Заголовки и cookie запроса — подменяются; redirect — исключение с адресом.
const request = vi.hoisted(() => ({ headers: new Headers(), jar: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => (request.jar.has(name) ? { value: request.jar.get(name) } : undefined),
    set: (name: string, value: string) => { request.jar.set(name, value); },
    delete: (c: string | { name: string }) => { request.jar.delete(typeof c === 'string' ? c : c.name); },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
// Счётчик — настоящий, в тестовой базе под ролью приложения.
vi.mock('@/db/client', async () => {
  const setup = await import('./setup');
  return {
    withAnon: <T>(fn: (tx: Tx) => Promise<T>) => setup.asAppAnon(fn),
    withManager: <T>(fn: (tx: Tx) => Promise<T>) => setup.asManager(fn),
  };
});
// Проверка пароля — настоящая, но со счётчиком вызовов. Задержка отказа считается,
// а не ждётся (сама задержка проверена в managerPassword.test.ts).
const password = vi.hoisted(() => ({ calls: 0, delays: 0 }));
vi.mock('@/lib/auth/managerPassword', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth/managerPassword')>();
  return {
    ...real,
    verifyManagerPassword: (p: string) => { password.calls += 1; return real.verifyManagerPassword(p); },
    loginFailDelay: async () => { password.delays += 1; },
  };
});

const { loginManager } = await import('@/app/login/actions');

const LOCKED = 'Слишком много попыток. Подождите 15 минут и попробуйте снова.';
const IP = '198.51.100.7';
const form = (p: string) => { const f = new FormData(); f.set('password', p); return f; };
const login = (p: string) => loginManager({ error: null }, form(p)).catch((e: Error) => e);

beforeAll(async () => {
  await resetTestDb();
  const salt = randomBytes(16).toString('hex');
  process.env.MANAGER_PASSWORD_HASH = `${salt}:${scryptSync('правильный-пароль', salt, 64).toString('hex')}`;
});

beforeEach(async () => {
  await testSql`delete from login_failure`;
  await testSql`delete from manager_session`;
  request.headers = new Headers({ 'x-vercel-forwarded-for': IP });
  request.jar.clear();
  password.calls = 0;
  password.delays = 0;
});

describe('вход менеджера', () => {
  it('неверный пароль — «Неверный пароль», неудача записана по хешу адреса, ответ с задержкой', async () => {
    expect(await login('неверный')).toEqual({ error: 'Неверный пароль' });
    expect(password.delays).toBe(1);
    const rows = await testSql`select ip_hash from login_failure`;
    expect(rows.map((r) => r.ip_hash)).toEqual([loginIpHash(IP)]);
  });

  it('сам адрес нигде в базе не сохраняется', async () => {
    await login('неверный');
    const [dump] = await testSql`select string_agg(ip_hash, ' ') as all from login_failure`;
    expect(dump.all).not.toContain(IP);
  });

  it('заблокированный адрес получает сообщение о блокировке, пароль не проверяется', async () => {
    await testSql`insert into login_failure (ip_hash)
      select ${loginIpHash(IP)} from generate_series(1, 10)`;
    expect(await login('правильный-пароль')).toEqual({ error: LOCKED });
    expect(password.calls).toBe(0);
    // Задержка та же, что при неверном пароле: по времени блокировку не отличить.
    expect(password.delays).toBe(1);
    // Попытка при блокировке не продлевает её: новых строк нет.
    const [{ count }] = await testSql`select count(*)::int as count from login_failure`;
    expect(count).toBe(10);
    expect(request.jar.has('manager_session')).toBe(false);
  });

  it('10 неверных паролей подряд закрывают вход, 11-я попытка — блокировка', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await login('неверный')).toEqual({ error: 'Неверный пароль' });
    }
    expect(password.calls).toBe(10);
    expect(await login('правильный-пароль')).toEqual({ error: LOCKED });
    expect(password.calls).toBe(10);
  });

  it('блокировка одного адреса не мешает другому', async () => {
    await testSql`insert into login_failure (ip_hash)
      select ${loginIpHash(IP)} from generate_series(1, 10)`;
    request.headers = new Headers({ 'x-vercel-forwarded-for': '198.51.100.8' });
    expect(await login('правильный-пароль')).toEqual(new Error('redirect:/month'));
  });

  it('верный пароль — сессия и переход без задержки и без записи неудачи', async () => {
    expect(await login('правильный-пароль')).toEqual(new Error('redirect:/month'));
    expect(password.delays).toBe(0);
    expect(request.jar.has('manager_session')).toBe(true);
    const [{ count }] = await testSql`select count(*)::int as count from login_failure`;
    expect(count).toBe(0);
  });
});
