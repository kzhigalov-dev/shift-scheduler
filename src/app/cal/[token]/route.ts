import { withAnon, withWorker } from '@/db/client';
import { feedWorkerId } from '@/lib/calendar/feedKeys';
import { ICS_HEADERS, workerFeed } from '@/lib/calendar/feeds';
import { originFromHeaders } from '@/lib/calendar/urls';
import { noStoreNotFound } from '@/lib/http/redirect';

/** Подписка работника на свои смены. Права — сам ключ из адреса (security definer). */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const workerId = await withAnon((tx) => feedWorkerId(tx, token));
  if (!workerId) return noStoreNotFound();
  const origin = originFromHeaders(request.headers);
  const body = await withWorker(workerId, (tx) => workerFeed(tx, workerId, { now: new Date(), origin }));
  return new Response(body, { headers: ICS_HEADERS });
}
