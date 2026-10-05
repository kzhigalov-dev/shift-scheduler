import postgres from 'postgres';
import type { Tx } from '@/db/client';
import { UserError } from '@/lib/errors';
import { generateToken, hashToken } from '@/lib/auth/token';

const bare = (raw: string) => raw.replace(/\.ics$/, '');

export const workerFeedPath = (token: string) => `/cal/${token}.ics`;
export const managerFeedPath = (token: string) => `/cal/m/${token}.ics`;

/** Ключ уже выдан, а замена не запрошена: действие отдаёт клиенту флаг `connected`, а не только текст. */
export class AlreadyConnectedError extends UserError {
  constructor() {
    super('Календарь уже подключён — создайте новую ссылку');
    this.name = 'AlreadyConnectedError';
  }
}

const RACE = 'Ссылку уже выдали в другом окне — обновите страницу и попробуйте ещё раз';

/**
 * Вставка ключа под уникальными индексами (по одному ключу на работника / менеджера).
 * `replace` — прежний ключ сначала удаляется; иначе существующий ключ не трогается и вставка
 * падает нарушением уникальности — это UserError, а не тихая замена. Гонка двух окон решается
 * тем же индексом: проигравший получает UserError, а его транзакция откатывается целиком.
 */
async function insertKey(tx: Tx, workerId: string | null, replace: boolean): Promise<string> {
  const token = generateToken();
  try {
    if (replace) {
      await (workerId === null
        ? tx`delete from calendar_feed where worker_id is null`
        : tx`delete from calendar_feed where worker_id = ${workerId}`);
    }
    await tx`insert into calendar_feed (worker_id, token_hash) values (${workerId}, ${hashToken(token)})`;
  } catch (error) {
    if (error instanceof postgres.PostgresError && error.code === '23505') {
      throw replace ? new UserError(RACE) : new AlreadyConnectedError();
    }
    throw error;
  }
  return token;
}

/** Ключ работника. Без `replace` при существующем ключе — UserError. Ключ возвращается один раз. */
export function issueWorkerFeed(tx: Tx, workerId: string, replace: boolean): Promise<string> {
  return insertKey(tx, workerId, replace);
}

/** Ключ менеджера; правила те же, что у ключа работника. */
export function issueManagerFeed(tx: Tx, replace: boolean): Promise<string> {
  return insertKey(tx, null, replace);
}

export async function hasWorkerFeed(tx: Tx, workerId: string): Promise<boolean> {
  const rows = await tx`select 1 from calendar_feed where worker_id = ${workerId}`;
  return rows.length > 0;
}

export async function hasManagerFeed(tx: Tx): Promise<boolean> {
  const rows = await tx`select 1 from calendar_feed where worker_id is null`;
  return rows.length > 0;
}

/** Без входа: id активного работника по ключу из адреса (с `.ics` или без). */
export async function feedWorkerId(tx: Tx, rawToken: string): Promise<string | null> {
  const [row] = await tx<{ id: string | null }[]>`
    select calendar_worker_by_token(${hashToken(bare(rawToken))}) as id`;
  return row?.id ?? null;
}

export async function isManagerFeed(tx: Tx, rawToken: string): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`
    select calendar_manager_token_valid(${hashToken(bare(rawToken))}) as ok`;
  return row?.ok === true;
}
