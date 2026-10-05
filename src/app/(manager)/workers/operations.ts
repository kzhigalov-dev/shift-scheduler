import postgres from 'postgres';
import type { Tx } from '@/db/client';
import { UserError } from '@/lib/errors';
import { generateToken, hashToken } from '@/lib/auth/token';
import { endWorkerSessions } from '@/lib/auth/workerSession';
import { cleanName, nameKey } from '@/lib/import/normalizeName';

export type WorkerRow = {
  id: string;
  fullName: string;
  phone: string | null;
  status: 'active' | 'archived';
  hasLink: boolean;
};

/** Разумный предел на телефон из формы — не формат, просто защита от мусора. */
export const MAX_PHONE_LENGTH = 32;

/** Телефон необязателен: пусто → null. Формат не проверяем, длину ограничиваем. */
export function parsePhone(value: FormDataEntryValue | null): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  if (s.length > MAX_PHONE_LENGTH) {
    throw new UserError(`Телефон слишком длинный (максимум ${MAX_PHONE_LENGTH} символов)`);
  }
  return s;
}

function duplicate(error: unknown): never {
  if (error instanceof postgres.PostgresError && error.code === '23505') {
    throw new UserError('Такой работник уже есть');
  }
  throw error;
}

export async function listWorkers(tx: Tx): Promise<WorkerRow[]> {
  const rows = await tx<Array<{
    id: string; full_name: string; phone: string | null;
    status: 'active' | 'archived'; has_link: boolean;
  }>>`
    select id, full_name, phone, status::text as status, token_hash is not null as has_link
    from worker order by full_name`;
  return rows.map((r) => ({
    id: r.id, fullName: r.full_name, phone: r.phone, status: r.status, hasLink: r.has_link,
  }));
}

export type WorkerStats = { active: number; archived: number; telegram: number; calendar: number };

/** Показатели «Работников» одним запросом: Telegram и календарь — только у работающих. */
export async function workerStats(tx: Tx): Promise<WorkerStats> {
  const [row] = await tx<WorkerStats[]>`
    select count(*) filter (where w.status = 'active')::int as active,
           count(*) filter (where w.status = 'archived')::int as archived,
           count(*) filter (where w.status = 'active'
             and exists (select 1 from telegram_link l where l.worker_id = w.id))::int as telegram,
           count(*) filter (where w.status = 'active'
             and exists (select 1 from calendar_feed f where f.worker_id = w.id))::int as calendar
    from worker w`;
  return row;
}

export async function createWorker(
  tx: Tx, { fullName, phone }: { fullName: string; phone: string | null },
): Promise<string> {
  if (!cleanName(fullName)) throw new UserError('Укажите имя');
  try {
    const [row] = await tx.savepoint((sp) => sp<{ id: string }[]>`
      insert into worker (full_name, name_key, phone)
      values (${cleanName(fullName)}, ${nameKey(fullName)}, ${phone})
      returning id`);
    return row.id;
  } catch (error) {
    return duplicate(error);
  }
}

export async function updateWorker(
  tx: Tx, { id, fullName, phone }: { id: string; fullName: string; phone: string | null },
): Promise<void> {
  if (!cleanName(fullName)) throw new UserError('Укажите имя');
  let rows: { id: string }[];
  try {
    rows = await tx.savepoint((sp) => sp<{ id: string }[]>`
      update worker set full_name = ${cleanName(fullName)}, name_key = ${nameKey(fullName)},
        phone = ${phone}
      where id = ${id}
      returning id`);
  } catch (error) {
    return duplicate(error);
  }
  if (rows.length === 0) throw new UserError('Работник не найден — обновите страницу');
}

/**
 * Возвращает открытый токен — единственный момент, когда он существует вне браузера. Заодно отключает Telegram
 * работника, закрывает его сессии и коды входа из бота и гасит ключ подписки на календарь (`end_worker_sessions`,
 * 0015): старая ссылка могла попасть к чужому.
 */
export async function issueToken(tx: Tx, workerId: string): Promise<string> {
  const token = generateToken();
  const updated = await tx`
    update worker set token_hash = ${hashToken(token)}, token_issued_at = now()
    where id = ${workerId} and status = 'active'
    returning id`;
  if (updated.length === 0) {
    const [worker] = await tx`select status from worker where id = ${workerId}`;
    if (!worker) throw new UserError('Работник не найден — обновите страницу');
    throw new UserError('Работник в архиве — сначала верните его');
  }
  // Кто получил старую ссылку, мог подключить свой Telegram: чат действует от имени работника, поэтому отключаем его.
  await tx`delete from telegram_link where worker_id = ${workerId}`;
  await endWorkerSessions(tx, workerId);
  return token;
}

/**
 * В архив: личная ссылка, сессии, коды входа из бота и ключ календаря перестают действовать, Telegram отключается —
 * восстановление из архива не возвращает ни вход из бота, ни подписку на календарь: их подключают заново.
 */
export async function archiveWorker(tx: Tx, workerId: string): Promise<void> {
  const rows = await tx`update worker set status = 'archived', token_hash = null, token_issued_at = null
           where id = ${workerId} returning id`;
  if (rows.length === 0) throw new UserError('Работник не найден — обновите страницу');
  await endWorkerSessions(tx, workerId);
  await tx`delete from telegram_link where worker_id = ${workerId}`;
}

export async function restoreWorker(tx: Tx, workerId: string): Promise<void> {
  const rows = await tx`update worker set status = 'active' where id = ${workerId} returning id`;
  if (rows.length === 0) throw new UserError('Работник не найден — обновите страницу');
}
