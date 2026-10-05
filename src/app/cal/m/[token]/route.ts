import { withAnon, withManager } from '@/db/client';
import { isManagerFeed } from '@/lib/calendar/feedKeys';
import { ICS_HEADERS, managerFeed } from '@/lib/calendar/feeds';
import { originFromHeaders } from '@/lib/calendar/urls';
import { noStoreNotFound } from '@/lib/http/redirect';

/** Подписка менеджера на все мероприятия. Права — сам ключ из адреса (security definer). */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await withAnon((tx) => isManagerFeed(tx, token));
  if (!valid) return noStoreNotFound();
  const origin = originFromHeaders(request.headers);
  const body = await withManager((tx) => managerFeed(tx, { now: new Date(), origin }));
  return new Response(body, { headers: ICS_HEADERS });
}
