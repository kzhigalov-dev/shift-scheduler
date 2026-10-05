'use server';

import { revalidatePath } from 'next/cache';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { UserError, userMessage } from '@/lib/errors';
import { issueLinkCode, unlink } from '@/lib/telegram/links';
import { deepLink, isTelegramConfigured } from '@/lib/telegram/config';
import { parseManagerPrefs } from '@/lib/telegram/prefs';

export type ActionResult = { error: string | null };
export type ConnectResult = { error: string | null; url: string | null };

/** Одноразовая ссылка на бота для чата менеджера. */
export async function connectManagerTelegramAction(): Promise<ConnectResult> {
  await requireManager();
  if (!isTelegramConfigured()) return { error: 'Telegram пока не настроен', url: null };
  try {
    const code = await withManager((tx) => issueLinkCode(tx, null));
    return { error: null, url: deepLink(code) };
  } catch (error) {
    return { error: userMessage(error), url: null };
  }
}

/** `raw` — JSON из браузера: значения приводятся к допустимым `parseManagerPrefs`. */
export async function saveManagerPrefsAction(raw: string): Promise<ActionResult> {
  await requireManager();
  let prefs;
  try {
    prefs = parseManagerPrefs(typeof raw === 'string' ? JSON.parse(raw) : null);
  } catch {
    return { error: 'Некорректный запрос' };
  }
  try {
    await withManager(async (tx) => {
      const rows = await tx`update telegram_link set prefs = ${tx.json(prefs)} where worker_id is null returning id`;
      if (rows.length === 0) throw new UserError('Сначала подключите Telegram');
    });
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath('/telegram');
  return { error: null };
}

export async function disconnectManagerTelegramAction(): Promise<ActionResult> {
  await requireManager();
  try {
    await withManager((tx) => unlink(tx, null));
  } catch (error) {
    return { error: userMessage(error) };
  }
  revalidatePath('/telegram');
  return { error: null };
}
