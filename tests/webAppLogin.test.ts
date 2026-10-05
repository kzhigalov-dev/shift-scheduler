import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Tx } from '@/db/client';
import { asAppAnon, asManager, asWorker, resetTestDb, testSql } from './setup';
import { hashToken } from '@/lib/auth/token';
import { webAppLogin, workerBySession } from '@/lib/auth/workerSession';
import { signInitData, tgUser, WEBAPP_TEST_TOKEN } from './webAppFixtures';

// Вход из Mini App целиком: cookie — из jar, база — тестовая под ролью приложения, ключ бота — тестовый.
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => { jar.set(name, value); },
    delete: (c: string | { name: string }) => { jar.delete(typeof c === 'string' ? c : c.name); },
  }),
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock('@/db/client', async () => {
  const setup = await import('./setup');
  return {
    withAnon: <T>(fn: (tx: Tx) => Promise<T>) => setup.asAppAnon(fn),
    withManager: <T>(fn: (tx: Tx) => Promise<T>) => setup.asManager(fn),
    withWorker: <T>(id: string, fn: (tx: Tx) => Promise<T>) => setup.asWorker(id, fn),
  };
});
const { webAppLoginAction } = await import('@/app/tg/actions');
const { getCurrentWorker } = await import('@/lib/auth/session');

const IAN_TG = 5_000_000_101; // id пользователя Telegram = chat_id личного чата
const MANAGER_TG = 5_000_000_900;
let ian: string;
const now = () => Math.floor(Date.now() / 1000);
let seq = 0;
/** Новый initData (разный query_id — разный hash), как при каждом открытии кнопки. */
const initData = (userId = IAN_TG, over: Record<string, string> = {}) =>
  signInitData({ query_id: `Q${++seq}`, user: tgUser(userId), auth_date: String(now() - 5), ...over });

beforeEach(async () => {
  await resetTestDb();
  jar.clear();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', WEBAPP_TEST_TOKEN);
  [{ id: ian }] = await testSql`insert into worker (full_name, name_key) values ('Ян', 'ян') returning id`;
  await testSql`insert into telegram_link (worker_id, chat_id) values (${ian}, ${IAN_TG}), (null, ${MANAGER_TG})`;
});
afterEach(() => { vi.unstubAllEnvs(); });

const sessions = () => testSql`select worker_id, chat_id from worker_session`;

describe('вход из Mini App (/tg/app)', () => {
  it('подпись верна, чат подключён — сессия работника, сессия менеджера этого браузера закрыта, путь из белого списка', async () => {
    const manager = 'm'.repeat(43);
    await testSql`insert into manager_session (token_hash, expires_at) values (${hashToken(manager)}, now() + interval '1 hour')`;
    jar.set('manager_session', manager);
    expect(await webAppLoginAction(initData(), '/available')).toEqual({ to: '/available' });
    expect(await asAppAnon((tx) => workerBySession(tx, jar.get('worker_session') ?? ''))).toEqual({ id: ian, fullName: 'Ян' });
    expect(await getCurrentWorker()).toEqual({ id: ian, fullName: 'Ян' });
    expect(jar.has('manager_session')).toBe(false);
    expect(await testSql`select 1 from manager_session`).toEqual([]);
    // Сессия помнит чат: отключение Telegram закроет и её.
    expect(await sessions()).toEqual([{ worker_id: ian, chat_id: String(IAN_TG) }]);
  });

  it('`to` не из белого списка — /shifts', async () => {
    for (const to of ['https://evil.example', '//evil.example', '/month', 42]) {
      jar.clear();
      expect(await webAppLoginAction(initData(), to)).toEqual({ to: '/shifts' });
    }
  });

  it('повтор того же initData — отказ, новой сессии нет', async () => {
    const data = initData();
    expect(await webAppLoginAction(data, '/shifts')).toEqual({ to: '/shifts' });
    jar.clear();
    expect(await webAppLoginAction(data, '/shifts')).toEqual({ error: expect.stringContaining('уже сработала') });
    expect(await sessions()).toHaveLength(1);
    expect(jar.has('worker_session')).toBe(false);
  });

  it('подделанное поле, просроченный и из будущего — отказ без записи в базу', async () => {
    const tampered = new URLSearchParams(initData());
    tampered.set('user', tgUser(IAN_TG + 1));
    for (const data of [
      tampered.toString(), initData(IAN_TG, { auth_date: String(now() - 86_401) }), initData(IAN_TG, { auth_date: String(now() + 600) }),
      'мусор', 17,
    ]) {
      expect(await webAppLoginAction(data, '/shifts')).toEqual({ error: expect.any(String) });
    }
    expect(await sessions()).toEqual([]);
    expect(await testSql`select 1 from telegram_webapp_login`).toEqual([]);
    expect(jar.size).toBe(0);
  });

  it('initData старше часа — «кнопка устарела»; защита от повтора живёт ровно срок приёма (час и 5 минут)', async () => {
    expect(await webAppLoginAction(initData(IAN_TG, { auth_date: String(now() - 3601) }), '/shifts'))
      .toEqual({ error: expect.stringContaining('устарела') });
    expect(await sessions()).toEqual([]);
    const authDate = now() - 60;
    expect(await webAppLoginAction(initData(IAN_TG, { auth_date: String(authDate) }), '/shifts')).toEqual({ to: '/shifts' });
    const [row] = await testSql<{ ttl: number }[]>`
      select extract(epoch from expires_at - to_timestamp(${authDate}))::int as ttl from telegram_webapp_login`;
    // greatest(auth_date, now()) + 1 час 5 минут: от auth_date — на минуту больше (вход через минуту после выдачи).
    expect(row.ttl).toBeGreaterThanOrEqual(3900);
    expect(row.ttl).toBeLessThan(3900 + 120);
  });

  it('чат менеджера — понятный отказ, сессии работника нет', async () => {
    expect(await webAppLoginAction(initData(MANAGER_TG), '/shifts')).toEqual({ error: expect.stringContaining('менеджер') });
    expect(await sessions()).toEqual([]);
  });

  it('неподключённый пользователь и архивный работник — отказ', async () => {
    expect(await webAppLoginAction(initData(42), '/shifts')).toEqual({ error: expect.stringContaining('не подключён') });
    await testSql`update worker set status = 'archived' where id = ${ian}`;
    expect(await webAppLoginAction(initData(), '/shifts')).toEqual({ error: expect.stringContaining('менеджер') });
    expect(await sessions()).toEqual([]);
  });

  it('ключ бота не задан — отказ без обращения к базе', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    expect(await webAppLoginAction(initData(), '/shifts')).toEqual({ error: expect.stringContaining('не настроен') });
    expect(await testSql`select 1 from telegram_webapp_login`).toEqual([]);
  });

  it('не больше 5 входов в минуту от одного пользователя', async () => {
    for (let i = 0; i < 5; i += 1) {
      jar.clear();
      expect(await webAppLoginAction(initData(), '/shifts')).toEqual({ to: '/shifts' });
    }
    jar.clear();
    expect(await webAppLoginAction(initData(), '/shifts')).toEqual({ error: expect.stringContaining('подождите') });
    expect(await sessions()).toHaveLength(5);
  });

  it('одновременные входы не превышают лимит пользователя и не задерживают другого пользователя', async () => {
    const login = (tx: Tx, userId = IAN_TG) => webAppLogin(tx, {
      userId, authDate: now() - 5, hash: new URLSearchParams(initData(userId)).get('hash')!,
    }, randomBytes(32).toString('base64url'), null);
    for (let i = 0; i < 4; i += 1) expect(await asAppAnon(tx => login(tx))).toBe('ok');
    const [other] = await testSql<{ id: string }[]>`insert into worker (full_name,name_key) values ('Ира','ира') returning id`;
    const otherTg = IAN_TG + 1;
    await testSql`insert into telegram_link (worker_id,chat_id) values (${other.id},${otherTg})`;
    let entered!: () => void; let release!: () => void;
    const ready = new Promise<void>(r => { entered = r; });
    const barrier = new Promise<void>(r => { release = r; });
    const first = asManager(async tx => {
      await tx`select id from worker where id=${ian} for update`;
      entered(); await barrier;
    });
    await ready;
    const pids: number[] = [];
    const requests = Promise.all(Array.from({ length: 2 }, () => asAppAnon(async tx => {
      const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      pids.push(row.pid);
      return login(tx);
    })));
    void requests.catch(() => {});
    try {
      // Обе транзакции дошли до ожидания: с исправлением — одна ждёт работника,
      // вторая — лимит пользователя; без исправления обе уже проверили старый счётчик.
      await expect.poll(async () => {
        if (pids.length !== 2) return 0;
        const [row] = await testSql<{ waiting: number }[]>`select count(*)::int as waiting
          from pg_stat_activity where pid in ${testSql(pids)} and cardinality(pg_blocking_pids(pid))>0`;
        return row.waiting;
      }, { timeout: 3000 }).toBe(2);
      expect(await asAppAnon(async tx => {
        await tx`set local statement_timeout='2s'`;
        return login(tx, otherTg);
      })).toBe('ok');
    } finally { release(); await first; await requests; }
    expect((await requests).sort()).toEqual(['ok', 'too_often']);
    expect(await testSql`select 1 from worker_session where worker_id=${ian}`).toHaveLength(5);
    expect(await testSql`select 1 from telegram_webapp_login where user_id=${IAN_TG}`).toHaveLength(5);
  });

  it('браузер уже вошёл этим работником через этот чат — новая сессия не создаётся (не вытесняет другие устройства)', async () => {
    expect(await webAppLoginAction(initData(), '/shifts')).toEqual({ to: '/shifts' });
    const first = jar.get('worker_session');
    expect(await webAppLoginAction(initData(), '/earnings')).toEqual({ to: '/earnings' });
    expect(jar.get('worker_session')).toBe(first);
    expect(await sessions()).toHaveLength(1);
  });

  it('отключение Telegram закрывает и сессию из Mini App', async () => {
    await webAppLoginAction(initData(), '/shifts');
    await asWorker(ian, (tx) => tx`delete from telegram_link where worker_id = ${ian}`);
    expect(await getCurrentWorker()).toBeNull();
  });

  it('app_user не читает таблицу повторов напрямую; RLS включён', async () => {
    for (const run of [asAppAnon, asManager, (fn: (tx: Tx) => Promise<unknown>) => asWorker(ian, fn)]) {
      await expect(run((tx) => tx`select * from telegram_webapp_login`)).rejects.toThrow(/permission denied/);
    }
    const [row] = await testSql`select relrowsecurity from pg_class where oid = 'telegram_webapp_login'::regclass`;
    expect(row.relrowsecurity).toBe(true);
  });
});
