import { timingSafeEqual } from 'node:crypto';
import { withAnon } from '@/db/client';
import { botToken, webhookSecret } from './config';

/** Запрос пришёл от Telegram: заголовок совпадает с секретом вебхука. Без ключа бота — всегда нет. */
export function isTelegramRequest(request: Request): boolean {
  const token = botToken();
  const got = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!token || !got) return false;
  const want = webhookSecret(token);
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Запрос пришёл от планировщика: секрет тика проверяет функция базы (security definer). */
export async function isTickRequest(request: Request): Promise<boolean> {
  const secret = request.headers.get('x-tick-secret') ?? '';
  if (!/^[0-9a-f]{64}$/.test(secret)) return false;
  const [row] = await withAnon((tx) => tx<{ ok: boolean }[]>`select tick_secret_valid(${secret}) as ok`);
  return row?.ok === true;
}
