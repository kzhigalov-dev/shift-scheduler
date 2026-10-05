import { withWorker } from '@/db/client';
import { requireWorker } from '@/lib/auth/session';
import { isUuid } from '@/lib/ids';
import { ICS_HEADERS, workerShiftFile } from '@/lib/calendar/feeds';
import { originFromHeaders } from '@/lib/calendar/urls';

/** Файл одной смены для календаря телефона. */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const worker = await requireWorker();
  const { eventId } = await params;
  if (!isUuid(eventId)) return new Response(null, { status: 404 });
  const origin = originFromHeaders(request.headers);
  const file = await withWorker(worker.id, (tx) => workerShiftFile(tx, worker.id, eventId, { now: new Date(), origin }));
  if (!file) return new Response(null, { status: 404 });
  return new Response(file.body, {
    headers: { ...ICS_HEADERS, 'Content-Disposition': `attachment; filename="smena-${file.date}.ics"` },
  });
}
