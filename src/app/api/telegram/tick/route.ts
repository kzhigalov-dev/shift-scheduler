import { withManager } from '@/db/client';
import { isTickRequest } from '@/lib/telegram/requests';
import { runTick } from '@/lib/telegram/tick';
import { botToken, webhookSecret } from '@/lib/telegram/config';
import { telegramApi } from '@/lib/telegram/api';
import { originFromHeaders } from '@/lib/calendar/urls';

export const maxDuration = 60;

/**
 * Раз в минуту от планировщика Supabase. Права — секрет тика из app_secret;
 * работа идёт от имени системы (роль менеджера): напоминания, очередь, отправка.
 */
export async function POST(request: Request) {
  if (!(await isTickRequest(request))) return new Response(null, { status: 401 });
  const token = botToken();
  // Фазы тика открывают свои короткие транзакции сами: отправка в Telegram — вне долгой транзакции.
  const summary = await runTick({
    now: new Date(),
    origin: originFromHeaders(request.headers),
    api: token ? telegramApi(token) : null,
    secret: token ? webhookSecret(token) : null,
    db: withManager,
  });
  return Response.json(summary);
}
