import { revalidatePath } from 'next/cache';
import { withAnon, withManager, withWorker } from '@/db/client';
import { isTelegramRequest } from '@/lib/telegram/requests';
import { parseUpdate } from '@/lib/telegram/update';
import { handleUpdate } from '@/lib/telegram/bot';
import { botToken } from '@/lib/telegram/config';
import { telegramApi } from '@/lib/telegram/api';
import { originFromHeaders } from '@/lib/calendar/urls';

/**
 * Обновления от Telegram. Права — секрет вебхука в заголовке (знает только Telegram);
 * дальше чат → владелец (`telegram_owner`), и действия идут от его имени:
 * работник — `withWorker`, менеджер — `withManager`, как у кнопок приложения.
 */
export async function POST(request: Request) {
  if (!isTelegramRequest(request)) return new Response(null, { status: 401 });
  const token = botToken();
  if (!token) return new Response(null, { status: 200 });
  const update = parseUpdate(await request.json().catch(() => null));
  await handleUpdate({
    api: telegramApi(token),
    origin: originFromHeaders(request.headers),
    now: new Date(),
    anon: withAnon,
    worker: (workerId) => (fn) => withWorker(workerId, fn),
    manager: withManager,
    revalidate: (paths) => { for (const path of paths) revalidatePath(path); },
  }, update);
  return new Response(null, { status: 200 });
}
