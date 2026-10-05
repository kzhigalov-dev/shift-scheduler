import type { Tx } from '@/db/client';
import { generateToken, hashToken } from './token';

export const MANAGER_SESSION_HOURS = 12;

/** Вызывать внутри withManager. Возвращает открытый токен для cookie. */
export async function createManagerSession(tx: Tx): Promise<string> {
  const token = generateToken();
  await tx`delete from manager_session where expires_at < now()`;
  await tx`
    insert into manager_session (token_hash, expires_at)
    values (${hashToken(token)}, now() + make_interval(hours => ${MANAGER_SESSION_HOURS}))`;
  return token;
}

/** Работает без личности — через manager_session_valid (security definer). */
export async function isManagerSessionValid(tx: Tx, token: string): Promise<boolean> {
  const [row] = await tx<{ valid: boolean }[]>`
    select manager_session_valid(${hashToken(token)}) as valid`;
  return row.valid;
}

export async function deleteManagerSession(tx: Tx, token: string): Promise<void> {
  await tx`delete from manager_session where token_hash = ${hashToken(token)}`;
}
