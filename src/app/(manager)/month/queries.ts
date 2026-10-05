import type { Tx } from '@/db/client';
import { monthRange } from '@/lib/month';

export type MonthEvent = {
  id: string;
  date: string;
  startTime: string;
  concert: string | null;
  tag: string;
  eventTypeId: string;
  eventTypeName: string;
  baseRate: number | null;
  needed: number;
  filled: number;
  unplaced: number;
  cancelRequests: number;
  pendingSignups: number;
};

/** События месяца со счётчиками набора — для экрана /month. */
export async function monthEvents(tx: Tx, month: string): Promise<MonthEvent[]> {
  const { from, to } = monthRange(month);
  const rows = await tx<Array<{
    id: string; event_date: string; start_time: string; concert: string | null; tag: string; event_type_id: string; event_type_name: string;
    base_rate: number | null; needed: number; filled: number; unplaced: number;
    cancel_requests: number; pending_signups: number;
  }>>`
    select e.id,
           to_char(e.event_date, 'YYYY-MM-DD') as event_date,
           to_char(e.start_time, 'HH24:MI') as start_time,
           e.concert, e.tag::text as tag, e.base_rate, e.event_type_id, t.name as event_type_name,
           coalesce((select sum(quantity) from event_slot s where s.event_id = e.id), 0)::int as needed,
           (select count(*) from assignment a where a.event_id = e.id)::int as filled,
           (select count(*) from assignment a
             where a.event_id = e.id and a.position_id is null)::int as unplaced,
           (select count(*) from assignment a
             where a.event_id = e.id and a.cancel_requested_at is not null)::int as cancel_requests,
           (select count(*) from signup g
             where g.event_id = e.id and g.status = 'pending')::int as pending_signups
    from event e join event_type t on t.id=e.event_type_id
    where e.event_date >= ${from}::date and e.event_date < ${to}::date
    order by e.event_date, e.start_time`;

  return rows.map((r) => ({
    id: r.id, date: r.event_date, startTime: r.start_time, concert: r.concert, tag: r.tag, eventTypeId:r.event_type_id, eventTypeName:r.event_type_name,
    baseRate: r.base_rate, needed: r.needed, filled: r.filled, unplaced: r.unplaced,
    cancelRequests: r.cancel_requests, pendingSignups: r.pending_signups,
  }));
}
