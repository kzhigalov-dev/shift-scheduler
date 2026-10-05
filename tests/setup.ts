import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Tx } from '@/db/client';

/**
 * Тесты сносят схему public. Защита от того, чтобы в DATABASE_URL_TEST
 * случайно оказалась боевая или dev-база.
 */
export function assertLocalTestDb(raw: string): void {
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const name = url.pathname.replace(/^\//, '');
  if (!local || !name.endsWith('_test')) {
    throw new Error(
      `Тесты разрешены только на локальной базе *_test, получено: ${url.hostname}/${name}`,
    );
  }
}

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST не задан');
assertLocalTestDb(url);

// prepare: false — обязательно, а не только для пулера: тесты сносят и
// пересоздают схему (enum-типы получают новые OID) в рамках одного и того же
// соединения. С именованными prepared statements (по умолчанию) postgres.js
// переиспользует ранее подготовленный запрос с OID типа из старой схемы, и
// Postgres отвечает `cache lookup failed for type …` — воспроизводится при
// повторном resetTestDb внутри одного файла (beforeEach, а не beforeAll).
export const testSql = postgres(url, { max: 4, prepare: false, onnotice: () => {} });

export async function resetTestDb(throughVersion?: string): Promise<void> {
  const dir = path.resolve(__dirname, '../supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (throughVersion !== undefined && (!/^\d{4}$/.test(throughVersion) || !files.some((f) => f.startsWith(throughVersion + '_')))) {
    throw new Error('Неизвестная версия миграции');
  }
  await testSql.unsafe('drop schema if exists public cascade; create schema public;');
  // Воспроизводим гранты, которые Supabase сам выдаёт anon/authenticated на схему
  // public — иначе в shift_test у этих ролей и так нет прав, и блок revoke в
  // 0002_rls.sql можно было бы выкинуть, а тест «нет прав» остался бы зелёным.
  await testSql.unsafe(`do $$ begin if exists (select 1 from pg_roles where rolname='anon') then
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
end if; end $$;`);
  for (const file of files.filter((f) => throughVersion === undefined || f.slice(0, 4) <= throughVersion)) {
    await testSql.unsafe(readFileSync(path.join(dir, file), 'utf8'));
  }
}

/**
 * Как в проде: роль app_user, RLS действует, личность — работник.
 * Часовой пояс — Europe/Moscow, как в withWorker (src/db/client.ts):
 * иначе `current_date`/`now()` в запросах и RLS-политиках считались бы
 * по часовому поясу сервера, а не по Москве.
 */
export function asWorker<T>(workerId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return testSql.begin(async (tx) => {
    await tx`set local role app_user`;
    await tx`select set_config('timezone', 'Europe/Moscow', true)`;
    await tx`select set_config('app.worker_id', ${workerId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Как в проде: роль app_user, личность — менеджер, часовой пояс — Europe/Moscow. */
export function asManager<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return testSql.begin(async (tx) => {
    await tx`set local role app_user`;
    await tx`select set_config('timezone', 'Europe/Moscow', true)`;
    await tx`select set_config('app.is_manager', 'true', true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Как в проде: роль app_user без личности (до входа). */
export function asAppAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return testSql.begin(async (tx) => {
    await tx`set local role app_user`;
    return fn(tx);
  }) as Promise<T>;
}
