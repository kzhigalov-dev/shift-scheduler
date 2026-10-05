import { withAnon } from '@/db/client';
import { hashToken } from './token';
import { loginCodeState, workerBySession, type LoginCodeState } from './workerSession';

export type CurrentWorker = { id: string; fullName: string };

/** Токены и коды — 32 байта в base64url (generateToken); иное в базу не несём. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const isTokenShape = (value: string): boolean => TOKEN.test(value);

/**
 * До входа личности нет, и RLS прячет таблицу worker целиком.
 * Поэтому поиск идёт через worker_by_token (security definer).
 */
export async function findWorkerByToken(token: string): Promise<CurrentWorker | null> {
  const rows = await withAnon((tx) =>
    tx<{ id: string; full_name: string }[]>`
      select id, full_name from worker_by_token(${hashToken(token)})`);
  return rows[0] ? { id: rows[0].id, fullName: rows[0].full_name } : null;
}

/** Работник по cookie `worker_session` (вход из бота) — через worker_by_session (security definer). */
export async function findWorkerBySession(token: string): Promise<CurrentWorker | null> {
  if (!TOKEN.test(token)) return null;
  return withAnon((tx) => workerBySession(tx, token));
}

/**
 * Что с кодом входа из бота (`/tg/[code]`) — без изменений: страница подтверждения показывает имя,
 * повтор после входа отличается от устаревшей ссылки. Код не той формы — `invalid`.
 */
export async function loginCodeInfo(code: string): Promise<LoginCodeState> {
  if (!TOKEN.test(code)) return { state: 'invalid', fullName: null };
  return withAnon((tx) => loginCodeState(tx, code));
}
