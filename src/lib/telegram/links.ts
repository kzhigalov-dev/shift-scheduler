import type { Tx } from '@/db/client';
import { generateToken, hashToken } from '@/lib/auth/token';
import type { RawPrefs } from './prefs';

export const LINK_CODE_MINUTES = 15;

/**
 * Одноразовый код для `/start` (24 символа base64url) на LINK_CODE_MINUTES минут;
 * прежние коды владельца удаляются. `null` — код менеджера. Владельца кода
 * функция `issue_telegram_code` берёт из личности сессии, а не из `workerId`.
 */
export async function issueLinkCode(tx: Tx, workerId: string | null): Promise<string> {
  const code = generateToken().slice(0, 24);
  await tx`select issue_telegram_code(${hashToken(code)}, ${workerId === null})`;
  return code;
}

export async function linkTelegram(tx: Tx, code: string, chatId: number): Promise<'worker' | 'manager' | 'invalid'> {
  const [row] = await tx<{ r: 'worker' | 'manager' | 'invalid' }[]>`
    select link_telegram(${hashToken(code)}, ${chatId}) as r`;
  return row.r;
}

export async function telegramOwner(tx: Tx, chatId: number): Promise<{ workerId: string | null; isManager: boolean } | null> {
  const [row] = await tx<{ worker_id: string | null; is_manager: boolean }[]>`
    select worker_id, is_manager from telegram_owner(${chatId})`;
  return row ? { workerId: row.worker_id, isManager: row.is_manager } : null;
}

/** `chat_id` — bigint: postgres.js отдаёт строку; id чатов Telegram помещаются в безопасное целое JS. */
export async function getLink(tx: Tx, workerId: string | null): Promise<{ chatId: number; prefs: RawPrefs } | null> {
  const rows = workerId === null
    ? await tx<{ chat_id: string; prefs: RawPrefs }[]>`select chat_id, prefs from telegram_link where worker_id is null`
    : await tx<{ chat_id: string; prefs: RawPrefs }[]>`select chat_id, prefs from telegram_link where worker_id = ${workerId}`;
  return rows[0] ? { chatId: Number(rows[0].chat_id), prefs: rows[0].prefs } : null;
}

/**
 * Отключить чат. У работника триггер базы (`end_worker_chat_access`, 0013) гасит его коды входа и сессии,
 * полученные через этот чат; `keepSession` — токен сессии этого браузера (cookie `worker_session`):
 * её он не трогает, иначе работник, вошедший из бота, потерял бы и этот вход.
 */
export async function unlink(tx: Tx, workerId: string | null, keepSession?: string | null): Promise<void> {
  if (workerId === null) {
    await tx`delete from telegram_link where worker_id is null`;
    return;
  }
  if (keepSession) await tx`select set_config('app.keep_worker_session', ${hashToken(keepSession)}, true)`;
  await tx`delete from telegram_link where worker_id = ${workerId}`;
}
