import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resetTestDb, testSql, asAppAnon, asManager } from './setup';
import {
  clientIp, loginIpHash, throttleKey, isLoginAllowed, noteLoginFailure, loginUnderAttack,
  LOGIN_GLOBAL_FAILURES, LOGIN_ATTACK_IP_FAILURES,
} from '@/lib/auth/loginThrottle';
import { enqueueLoginAlert } from '@/lib/telegram/tick';
import { LOGIN_ATTACK_TEXT } from '@/lib/telegram/messages';

const h = (entries: Record<string, string>) => new Headers(entries);

describe('адрес клиента из заголовков', () => {
  it('сначала x-vercel-forwarded-for', () => {
    expect(clientIp(h({
      'x-vercel-forwarded-for': '203.0.113.1',
      'x-real-ip': '203.0.113.2',
      'x-forwarded-for': '203.0.113.3',
    }))).toBe('203.0.113.1');
  });

  it('затем x-real-ip', () => {
    expect(clientIp(h({ 'x-real-ip': '203.0.113.2', 'x-forwarded-for': '203.0.113.3' }))).toBe('203.0.113.2');
  });

  it('затем первый адрес x-forwarded-for, без пробелов', () => {
    expect(clientIp(h({ 'x-forwarded-for': ' 203.0.113.3 , 10.0.0.1, 10.0.0.2' }))).toBe('203.0.113.3');
  });

  it('пустой заголовок пропускается', () => {
    expect(clientIp(h({ 'x-vercel-forwarded-for': '', 'x-real-ip': ' ', 'x-forwarded-for': '203.0.113.3' })))
      .toBe('203.0.113.3');
  });

  it('без заголовков — unknown', () => {
    expect(clientIp(h({}))).toBe('unknown');
  });
});

describe('ключ счётчика', () => {
  it('IPv4 — как есть', () => expect(throttleKey('203.0.113.7')).toBe('203.0.113.7'));
  it('IPv6 — подсеть /64, сокращения раскрываются', () => {
    expect(throttleKey('2001:db8:85a3:0001:1111:2222:3333:4444')).toBe('2001:db8:85a3:1::/64');
    expect(throttleKey('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(throttleKey('2001:db8:0:0:ffff::9')).toBe(throttleKey('2001:db8::abcd'));
  });
  it('IPv4 внутри IPv6 — как IPv4', () => expect(throttleKey('::ffff:203.0.113.7')).toBe('203.0.113.7'));
  it('адреса одной /64 делят счётчик, другой /64 — нет', () => {
    expect(loginIpHash('2001:db8:1:2::a')).toBe(loginIpHash('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(loginIpHash('2001:db8:1:2::a')).not.toBe(loginIpHash('2001:db8:1:3::a'));
  });
});

describe('хеш адреса', () => {
  it("sha256('login:' + ip) в hex", () => {
    expect(loginIpHash('203.0.113.1'))
      .toBe(createHash('sha256').update('login:203.0.113.1').digest('hex'));
    expect(loginIpHash('203.0.113.1')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('сам адрес в хеш не попадает, разные адреса — разные хеши', () => {
    expect(loginIpHash('203.0.113.1')).not.toContain('203');
    expect(loginIpHash('203.0.113.1')).not.toBe(loginIpHash('203.0.113.2'));
    // Соль 'login:' — не голый sha256 адреса: чужая таблица хешей IP не подходит.
    expect(loginIpHash('203.0.113.1')).not.toBe(createHash('sha256').update('203.0.113.1').digest('hex'));
  });
});

const A = loginIpHash('203.0.113.1');
const B = loginIpHash('203.0.113.2');

/** Неудачи «в прошлом» — напрямую владельцем базы, мимо функции. */
const failAgo = (ipHash: string, ago: string, count = 1) => testSql`
  insert into login_failure (ip_hash, at)
  select ${ipHash}, now() - ${ago}::interval from generate_series(1, ${count})`;

const allowed = (ipHash: string) => asAppAnon((tx) => isLoginAllowed(tx, ipHash));
const fail = (ipHash: string) => asAppAnon((tx) => noteLoginFailure(tx, ipHash));

describe('счётчик неудачных входов (login_allowed / note_login_failure)', () => {
  beforeAll(() => resetTestDb());
  beforeEach(async () => {
    await testSql`delete from login_failure`;
  });

  it('9 неудач за 15 минут — вход ещё открыт, 10-я закрывает', async () => {
    for (let i = 0; i < 9; i++) await fail(A);
    expect(await allowed(A)).toBe(true);
    await fail(A);
    expect(await allowed(A)).toBe(false);
  });

  it('другой адрес не затронут', async () => {
    for (let i = 0; i < 10; i++) await fail(A);
    expect(await allowed(A)).toBe(false);
    expect(await allowed(B)).toBe(true);
  });

  it('неудачи старше 15 минут не считаются', async () => {
    await failAgo(A, '16 minutes', 20);
    await failAgo(A, '14 minutes', 9);
    expect(await allowed(A)).toBe(true);
    await fail(A);
    expect(await allowed(A)).toBe(false);
  });

  it('при записи неудачи строки старше суток удаляются, свежие остаются', async () => {
    await failAgo(B, '25 hours', 3);
    await failAgo(B, '23 hours', 2);
    await fail(A);
    const rows = await testSql`select ip_hash, at > now() - interval '1 day' as fresh from login_failure`;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.fresh)).toBe(true);
  });

  it('в таблицу нельзя записать сам адрес — только hex sha256', async () => {
    await expect(asAppAnon((tx) => noteLoginFailure(tx, '203.0.113.1'))).rejects.toThrow(/check constraint/);
  });

  it('функции работают и из сессии менеджера (security definer)', async () => {
    await asManager((tx) => noteLoginFailure(tx, A));
    expect(await asManager((tx) => isLoginAllowed(tx, A))).toBe(true);
  });
});

/** Неудачи с разных адресов за последний час — как перебор через прокси. */
const failMany = (count: number, ago = '1 minute') => testSql`
  insert into login_failure (ip_hash, at)
  select encode(sha256(convert_to('login:198.51.100.' || g, 'UTF8')), 'hex'), now() - ${ago}::interval
  from generate_series(1, ${count}) g`;

describe('общий предел неудач со всех адресов (L3): строже, но не навсегда', () => {
  beforeAll(() => resetTestDb());
  beforeEach(async () => {
    await testSql`delete from login_failure`;
  });

  it('пока за час меньше LOGIN_GLOBAL_FAILURES неудач — обычные 10 на адрес', async () => {
    await failMany(LOGIN_GLOBAL_FAILURES - 10);
    for (let i = 0; i < 9; i++) await fail(A);
    expect(await asAppAnon((tx) => loginUnderAttack(tx))).toBe(false);
    expect(await allowed(A)).toBe(true);
  });

  it('перебор со многих адресов: адресу, где уже ошибались, — только LOGIN_ATTACK_IP_FAILURES попыток за 15 минут', async () => {
    await failMany(LOGIN_GLOBAL_FAILURES);
    expect(await asAppAnon((tx) => loginUnderAttack(tx))).toBe(true);
    for (let i = 0; i < LOGIN_ATTACK_IP_FAILURES - 1; i++) await fail(A);
    expect(await allowed(A)).toBe(true);
    await fail(A);
    expect(await allowed(A)).toBe(false);
  });

  it('менеджер с чистого адреса входит при любом размахе перебора — запереть его нельзя', async () => {
    await failMany(10000);
    expect(await allowed(B)).toBe(true);
  });

  it('перебор закончился час назад — снова обычный предел', async () => {
    await failMany(LOGIN_GLOBAL_FAILURES * 3, '61 minutes');
    expect(await asAppAnon((tx) => loginUnderAttack(tx))).toBe(false);
    for (let i = 0; i < LOGIN_ATTACK_IP_FAILURES; i++) await fail(A);
    expect(await allowed(A)).toBe(true);
  });

  it('при переборе менеджеру в Telegram — одно предупреждение в час', async () => {
    await testSql`delete from telegram_link`;
    await testSql`delete from tg_outbox`;
    await testSql`insert into telegram_link (worker_id, chat_id) values (null, 900)`;
    const now = new Date();
    await asManager((tx) => enqueueLoginAlert(tx, now));
    expect(await testSql`select 1 from tg_outbox`).toHaveLength(0);
    await failMany(LOGIN_GLOBAL_FAILURES);
    await asManager((tx) => enqueueLoginAlert(tx, now));
    await asManager((tx) => enqueueLoginAlert(tx, now));
    const rows = await testSql`select chat_id::int as chat, text from tg_outbox`;
    expect(rows).toEqual([{ chat: 900, text: LOGIN_ATTACK_TEXT }]);
  });
});

describe('права на счётчик', () => {
  beforeAll(() => resetTestDb());

  it('app_user не читает и не пишет login_failure напрямую', async () => {
    await expect(asAppAnon((tx) => tx`select * from login_failure`)).rejects.toThrow(/permission denied/);
    await expect(asManager((tx) => tx`select * from login_failure`)).rejects.toThrow(/permission denied/);
    await expect(asManager((tx) => tx`insert into login_failure (ip_hash) values (${A})`))
      .rejects.toThrow(/permission denied/);
    await expect(asManager((tx) => tx`delete from login_failure`)).rejects.toThrow(/permission denied/);
  });

  it('app_user исполняет функции счётчика, PUBLIC — ни одну', async () => {
    const rows = await testSql`
      select p.proname,
             has_function_privilege('app_user', p.oid, 'execute') as app_user,
             exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
                     where grantee = 0 and privilege_type = 'EXECUTE') as public
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('login_allowed', 'note_login_failure', 'login_under_attack')
      order by p.proname`;
    expect(rows).toEqual([
      { proname: 'login_allowed', app_user: true, public: false },
      { proname: 'login_under_attack', app_user: true, public: false },
      { proname: 'note_login_failure', app_user: true, public: false },
    ]);
  });

  it('anon и authenticated не исполняют функции и не видят таблицу', async () => {
    const roles = await testSql`select rolname from pg_roles where rolname in ('anon', 'authenticated')`;
    if (roles.length === 0) return; // голый Postgres без ролей Supabase
    for (const role of ['anon', 'authenticated']) {
      await expect(testSql.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        return tx`select login_allowed(${A})`;
      })).rejects.toThrow(/permission denied/);
      await expect(testSql.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        return tx`select note_login_failure(${A})`;
      })).rejects.toThrow(/permission denied/);
      await expect(testSql.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        return tx`select * from login_failure`;
      })).rejects.toThrow(/permission denied/);
    }
  });

  it('RLS на login_failure включён', async () => {
    const [rls] = await testSql`select relrowsecurity from pg_class where oid = 'login_failure'::regclass`;
    expect(rls.relrowsecurity).toBe(true);
  });
});

describe('0010 закрывает таблицы видов (0009) для anon и authenticated', () => {
  const m0010 = () => testSql.unsafe(readFileSync(path.resolve(__dirname,
    '../supabase/migrations/0010_login_throttle.sql'), 'utf8'));

  const grants = (grantees: string[]) => testSql`
    select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('event_type', 'event_type_slot')
      and grantee in ${testSql(grantees)}
    order by grantee, table_name, privilege_type`;
  const columnGrants = () => testSql`
    select table_name, column_name, privilege_type from information_schema.column_privileges
    where table_schema = 'public' and table_name in ('event_type', 'event_type_slot') and grantee = 'app_user'
    order by table_name, column_name, privilege_type`;

  it('права, выданные anon, authenticated и PUBLIC в обход default privileges, снимаются; app_user — без изменений', async () => {
    const roles = await testSql`select rolname from pg_roles where rolname in ('anon', 'authenticated')`;
    await resetTestDb('0009');
    const appBefore = await grants(['app_user']);
    const columnsBefore = await columnGrants();
    expect(appBefore.length).toBeGreaterThan(0);
    // Как если бы таблицы создал supabase_admin, чей default ACL ещё выдаёт права anon/authenticated.
    const leaked = ['public', ...roles.map((r) => r.rolname as string)].join(', ');
    await testSql.unsafe(`grant all on event_type, event_type_slot to ${leaked}`);
    expect((await grants(['PUBLIC', 'anon', 'authenticated'])).length).toBeGreaterThan(0);

    await m0010();

    expect(await grants(['PUBLIC', 'anon', 'authenticated'])).toEqual([]);
    expect(await grants(['app_user'])).toEqual(appBefore);
    expect(await columnGrants()).toEqual(columnsBefore);
  });
});
