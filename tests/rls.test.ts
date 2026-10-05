import { describe, it, expect, beforeAll } from 'vitest';
import { resetTestDb, testSql, asWorker, asManager, asAppAnon } from './setup';

let alice: string;
let bob: string;
let eventId: string;
let hall: string;

beforeAll(async () => {
  await resetTestDb();
  const [a] = await testSql`insert into worker (full_name, name_key, phone, token_hash)
    values ('Алиса', 'алиса', '+79990000001', 'hash-alice') returning id`;
  const [b] = await testSql`insert into worker (full_name, name_key, phone, token_hash, status)
    values ('Боб', 'боб', '+79990000002', 'hash-bob', 'archived') returning id`;
  const [e] = await testSql`insert into event (event_date, start_time, base_rate)
    values ('2099-07-09', '20:00', 1300) returning id`;
  const [p] = await testSql`select id from position where name = 'ЗАЛ'`;
  alice = a.id; bob = b.id; eventId = e.id; hall = p.id;
  await testSql`insert into assignment (worker_id, event_id, position_id)
    values (${alice}, ${eventId}, ${hall})`;
  await testSql`insert into manager_session (token_hash, expires_at)
    values ('session-hash', now() + interval '1 hour')`;
});

describe('устройство защиты', () => {
  it('RLS включён на каждой таблице public', async () => {
    const rows = await testSql`
      select relname from pg_class
      where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('у каждой таблицы public есть хотя бы одна политика', async () => {
    const rows = await testSql`
      select c.relname from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('у каждой функции public зафиксирован search_path', async () => {
    const rows = await testSql`
      select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`;
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it('app_user не владеет ни одной таблицей', async () => {
    const rows = await testSql`
      select tablename from pg_tables where schemaname = 'public' and tableowner = 'app_user'`;
    expect(rows).toEqual([]);
  });

  it('у anon и authenticated нет прав на таблицы и функции', async () => {
    const roles = await testSql`
      select rolname from pg_roles where rolname in ('anon', 'authenticated')`;
    if (roles.length === 0) return; // голый Postgres без ролей Supabase
    const tables = await testSql`
      select table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')`;
    expect(tables).toEqual([]);
    const fns = await testSql`
      select p.oid::regprocedure::text as fn from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))`;
    expect(fns).toEqual([]);
  });
});

describe('работник', () => {
  it('видит своё назначение', async () => {
    const rows = await asWorker(alice, (tx) => tx`select id from assignment`);
    expect(rows).toHaveLength(1);
  });

  it('не видит чужое назначение', async () => {
    const rows = await asWorker(bob, (tx) => tx`select id from assignment`);
    expect(rows).toHaveLength(0);
  });

  it('видит свой телефон и не видит чужой', async () => {
    const own = await asWorker(alice, (tx) => tx`select phone from worker`);
    expect(own.map((r) => r.phone)).toEqual(['+79990000001']);
  });

  it('не может записать назначение', async () => {
    await expect(
      asWorker(bob, (tx) =>
        tx`insert into assignment (worker_id, event_id) values (${bob}, ${eventId})`),
    ).rejects.toThrow(/row-level security/);
  });

  it('не может подать заявку за другого', async () => {
    await expect(
      asWorker(bob, (tx) =>
        tx`insert into signup (worker_id, event_id) values (${alice}, ${eventId})`),
    ).rejects.toThrow(/row-level security/);
  });

  it('не может подать сразу принятую заявку', async () => {
    await expect(
      asWorker(bob, (tx) =>
        tx`insert into signup (worker_id, event_id, status)
           values (${bob}, ${eventId}, 'accepted')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('не может подать заявку на прошедшее событие', async () => {
    const [ePast] = await testSql`insert into event (event_date, start_time)
      values ('2020-01-01', '20:00') returning id`;
    await expect(
      asWorker(alice, (tx) =>
        tx`insert into signup (worker_id, event_id) values (${alice}, ${ePast.id})`),
    ).rejects.toThrow(/row-level security/);
    await testSql`delete from event where id = ${ePast.id}`;
  });

  it('может отозвать свою неутверждённую заявку, но не принятую', async () => {
    await testSql`insert into signup (worker_id, event_id, status)
                  values (${alice}, ${eventId}, 'accepted')`;
    const deleted = await asWorker(alice, (tx) =>
      tx`delete from signup where worker_id = ${alice} returning id`);
    expect(deleted).toHaveLength(0);
    await testSql`delete from signup`;
  });

  it('не может менять заявки, назначения и карточки', async () => {
    await testSql`insert into signup (worker_id, event_id) values (${alice}, ${eventId})`;
    const r = await asWorker(alice, async (tx) => [
      await tx`update signup set status = 'accepted' where worker_id = ${alice} returning id`,
      await tx`update assignment set rate = 99999 where worker_id = ${alice} returning id`,
      await tx`update assignment set worker_id = ${bob} where worker_id = ${alice} returning id`,
      await tx`update worker set status = 'active', token_hash = 'x' where id = ${bob} returning id`,
      await tx`update worker set status = 'archived' where id = ${alice} returning id`,
      await tx`delete from assignment where worker_id = ${alice} returning id`,
    ]);
    expect(r.map((x) => x.length)).toEqual([0, 0, 0, 0, 0, 0]);
    await testSql`delete from signup`;
  });

  it('подаёт и отзывает свою неутверждённую заявку', async () => {
    const [s] = await asWorker(alice, (tx) =>
      tx`insert into signup (worker_id, event_id) values (${alice}, ${eventId}) returning id`);
    const del = await asWorker(alice, (tx) =>
      tx`delete from signup where id = ${s.id} returning id`);
    expect(del).toHaveLength(1);
  });

  it('не может проставить created_at при подаче заявки', async () => {
    await expect(
      asWorker(alice, (tx) =>
        tx`insert into signup (worker_id, event_id, status, created_at)
           values (${alice}, ${eventId}, 'pending', now())`),
    ).rejects.toThrow(/permission denied/);
  });

  it('не видит сессии менеджера', async () => {
    const rows = await asWorker(alice, (tx) => tx`select token_hash from manager_session`);
    expect(rows).toHaveLength(0);
  });

  it('видит события', async () => {
    const rows = await asWorker(alice, (tx) => tx`select id from event`);
    expect(rows).toHaveLength(1);
  });
});

describe('без личности', () => {
  it('не видит ни событий, ни работников', async () => {
    const events = await asAppAnon((tx) => tx`select id from event`);
    const workers = await asAppAnon((tx) => tx`select id from worker`);
    expect(events).toHaveLength(0);
    expect(workers).toHaveLength(0);
  });

  it('находит активного работника по хешу токена', async () => {
    const rows = await asAppAnon((tx) =>
      tx`select id, full_name from worker_by_token('hash-alice')`);
    expect(rows).toEqual([{ id: alice, full_name: 'Алиса' }]);
  });

  it('не находит архивного и несуществующего', async () => {
    const archived = await asAppAnon((tx) => tx`select id from worker_by_token('hash-bob')`);
    const missing = await asAppAnon((tx) => tx`select id from worker_by_token('nope')`);
    expect(archived).toHaveLength(0);
    expect(missing).toHaveLength(0);
  });

  it('проверяет сессию менеджера по хешу и сроку', async () => {
    await testSql`insert into manager_session (token_hash, expires_at)
                  values ('expired-hash', now() - interval '1 minute')`;
    const [ok] = await asAppAnon((tx) =>
      tx`select manager_session_valid('session-hash') as v`);
    const [expired] = await asAppAnon((tx) =>
      tx`select manager_session_valid('expired-hash') as v`);
    const [missing] = await asAppAnon((tx) => tx`select manager_session_valid('nope') as v`);
    expect([ok.v, expired.v, missing.v]).toEqual([true, false, false]);
  });
});

describe('запрос отмены', () => {
  it('работник ставит отметку на своё назначение', async () => {
    const [r] = await asWorker(alice, (tx) => tx`select request_cancel(${eventId}) as ok`);
    expect(r.ok).toBe(true);
    const [row] = await testSql`
      select cancel_requested_at from assignment where worker_id = ${alice}`;
    expect(row.cancel_requested_at).not.toBeNull();
  });

  it('повторный запрос возвращает false', async () => {
    const [r] = await asWorker(alice, (tx) => tx`select request_cancel(${eventId}) as ok`);
    expect(r.ok).toBe(false);
  });

  it('на чужое назначение не действует', async () => {
    const [e2] = await testSql`insert into event (event_date, start_time)
      values ('2099-07-10', '20:00') returning id`;
    await testSql`insert into assignment (worker_id, event_id) values (${alice}, ${e2.id})`;
    const [r] = await asWorker(bob, (tx) => tx`select request_cancel(${e2.id}) as ok`);
    const [none] = await asAppAnon((tx) => tx`select request_cancel(${e2.id}) as ok`);
    const [row] = await testSql`select cancel_requested_at from assignment
      where worker_id = ${alice} and event_id = ${e2.id}`;
    await testSql`delete from event where id = ${e2.id}`;
    expect([r.ok, none.ok]).toEqual([false, false]);
    expect(row.cancel_requested_at).toBeNull();
  });

  it('не действует на прошедшее событие', async () => {
    const [ePast] = await testSql`insert into event (event_date, start_time)
      values ('2020-01-01', '20:00') returning id`;
    await testSql`insert into assignment (worker_id, event_id) values (${alice}, ${ePast.id})`;
    const [r] = await asWorker(alice, (tx) => tx`select request_cancel(${ePast.id}) as ok`);
    await testSql`delete from event where id = ${ePast.id}`;
    expect(r.ok).toBe(false);
  });
});

describe('менеджер', () => {
  it('видит всё и может назначать', async () => {
    const rows = await asManager((tx) => tx`select id from assignment`);
    expect(rows).toHaveLength(1);
    await expect(
      asManager((tx) =>
        tx`insert into assignment (worker_id, event_id) values (${bob}, ${eventId})`),
    ).resolves.toBeDefined();
  });
});
