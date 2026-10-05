'use server';

import { revalidatePath } from 'next/cache';
import { withWorker } from '@/db/client';
import { requireWorker, workerSessionToken } from '@/lib/auth/session';
import { UserError, userMessage } from '@/lib/errors';
import { issueLinkCode, unlink } from '@/lib/telegram/links';
import { deepLink, isTelegramConfigured } from '@/lib/telegram/config';
import { parseWorkerPrefs } from '@/lib/telegram/prefs';

export type ActionResult = { error: string | null };
export type ConnectResult = { error: string | null; url: string | null };

/** Одноразовая ссылка на бота. Владелец кода — из сессии, не из аргументов. */
export async function connectTelegramAction(): Promise<ConnectResult> {
  const worker = await requireWorker();
  if (!isTelegramConfigured()) return { error: 'Telegram пока не настроен', url: null };
  try {
    const code = await withWorker(worker.id, (tx) => issueLinkCode(tx, worker.id));
    return { error: null, url: deepLink(code) };
  } catch (error) {
    return { error: userMessage(error), url: null };
  }
}

/** `raw` — JSON из браузера: значения приводятся к допустимым `parseWorkerPrefs`. */
export async function saveWorkerPrefsAction(raw: string): Promise<ActionResult> {
  const worker = await requireWorker();
  let prefs;
  try {
    prefs = parseWorkerPrefs(typeof raw === 'string' ? JSON.parse(raw) : null);
  } catch {
    return { error: 'Некорректный запрос' };
  }
  try {
    await withWorker(worker.id, async (tx) => {
      const rows = await tx`update telegram_link set prefs = ${tx.json(prefs)} where worker_id = ${worker.id} returning id`;
      if (rows.length === 0) throw new UserError('Сначала подключите Telegram');
    });
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath('/notifications');
  return { error: null };
}

/** Входы через этот чат на других устройствах закрываются; вход этого браузера остаётся. */
export async function disconnectTelegramAction(): Promise<ActionResult> {
  const worker = await requireWorker();
  const keep = await workerSessionToken();
  try {
    await withWorker(worker.id, (tx) => unlink(tx, worker.id, keep));
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath('/notifications');
  return { error: null };
}
