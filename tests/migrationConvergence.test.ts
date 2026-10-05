import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { asAppAnon, resetTestDb, testSql } from './setup';
import { webAppLogin } from '@/lib/auth/workerSession';

/**
 * 0011 и 0012 правились после применения (ревью, L9). 0013 обязана приводить к одному состоянию
 * любую базу: собранную из окончательных текстов и из самых ранних (tests/fixtures/migration-history —
 * тексты из git: 0011 из 0aa84ec, 0012 из cf68ad6). Сравниваются тексты и права функций, триггеры,
 * колонки, индексы, политики и права таблиц схемы public.
 */
const read = (file: string) => readFileSync(path.resolve(__dirname, file), 'utf8');
const MIGRATION_0013 = read('../supabase/migrations/0013_review_fixes.sql');

async function snapshot() {
  return {
    functions: await testSql`select p.proname, pg_get_function_identity_arguments(p.oid) as args,
        pg_get_functiondef(p.oid) as def, coalesce(p.proacl::text, '') as acl
      from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1, 2`,
    triggers: await testSql`select tgrelid::regclass::text as rel, tgname, pg_get_triggerdef(oid) as def
      from pg_trigger where not tgisinternal order by 1, 2`,
    columns: await testSql`select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns where table_schema = 'public' order by 1, 2`,
    indexes: await testSql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`,
    policies: await testSql`select tablename, policyname, cmd, qual, with_check from pg_policies
      where schemaname = 'public' order by 1, 2`,
    tables: await testSql`select relname, relrowsecurity, coalesce(relacl::text, '') as acl from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`,
  };
}

async function fromEarliest(through0013: boolean) {
  await resetTestDb('0010');
  await testSql.unsafe(read('fixtures/migration-history/0011_worker_login.v1.sql'));
  await testSql.unsafe(read('fixtures/migration-history/0012_event_type_rates.v1.sql'));
  if (through0013) await testSql.unsafe(MIGRATION_0013);
}

it('ранние тексты 0011/0012 дают другую базу — проверка не пустая', async () => {
  await resetTestDb('0012');
  const current = await snapshot();
  await fromEarliest(false);
  expect((await snapshot()).functions).not.toEqual(current.functions);
});

it('0013 приводит базы из ранних и окончательных 0011/0012 к одному состоянию и идемпотентна', async () => {
  await resetTestDb('0013');
  const expected = await snapshot();
  expect(expected.functions.map((f) => `${f.proname}(${f.args})`)).not.toContain('issue_worker_login_code(p_code_hash text)');

  await fromEarliest(true);
  expect(await snapshot()).toEqual(expected);

  await testSql.unsafe(MIGRATION_0013);
  expect(await snapshot()).toEqual(expected);
});

it('0014 обновляет существующую базу без потери сессий и защиты от повтора; повторное применение безопасно', async () => {
  await resetTestDb('0013');
  const [worker] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key)
    values ('Миграция входа','миграция входа') returning id`;
  const userId = 5_000_000_123;
  await testSql`insert into telegram_link(worker_id,chat_id) values (${worker.id},${userId})`;
  const auth = { userId, authDate: Math.floor(Date.now() / 1000), hash: 'a'.repeat(64) };
  const login = () => asAppAnon(tx => webAppLogin(tx, auth, 's'.repeat(43), null));
  expect(await login()).toBe('ok');
  const data = async () => ({
    sessions: await testSql`select * from worker_session order by token_hash`,
    logins: await testSql`select * from telegram_webapp_login order by init_hash`,
  });
  const before = await data();
  const migration = read('../supabase/migrations/0014_webapp_login_limit.sql');
  await testSql.unsafe(migration);
  expect(await data()).toEqual(before);
  expect(await login()).toBe('replay');
  const upgraded = await snapshot();
  await testSql.unsafe(migration);
  expect(await snapshot()).toEqual(upgraded);
  expect(await data()).toEqual(before);
  await resetTestDb('0014');
  expect(await snapshot()).toEqual(upgraded);
});

it('0015 обновляет базу 0014 к тому же состоянию, что и чистая установка; данные сохраняются; повтор безопасен', async () => {
  await resetTestDb('0014');
  const [worker] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key)
    values ('Миграция безопасности','миграция безопасности') returning id`;
  await testSql`insert into telegram_link(worker_id,chat_id) values (${worker.id},5000000124)`;
  await testSql`insert into worker_session(token_hash,worker_id,chat_id,expires_at)
    values (${'b'.repeat(64)},${worker.id},5000000124,now() + interval '1 year')`;
  await testSql`insert into calendar_feed(worker_id,token_hash) values (${worker.id},${'c'.repeat(64)})`;
  const data = async () => ({
    sessions: await testSql`select * from worker_session order by token_hash`,
    feeds: await testSql`select * from calendar_feed order by token_hash`,
  });
  const before = await data();
  const migration = read('../supabase/migrations/0015_security_full.sql');
  await testSql.unsafe(migration);
  expect(await data()).toEqual(before);
  const upgraded = await snapshot();
  await testSql.unsafe(migration);
  expect(await snapshot()).toEqual(upgraded);
  await resetTestDb('0015');
  expect(await snapshot()).toEqual(upgraded);
});
