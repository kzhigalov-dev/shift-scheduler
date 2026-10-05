import type { Tx } from '@/db/client';
import { monthRange } from '@/lib/month';
import { getMonthPlan } from '@/lib/monthPlan/plan';
import type { ExportEvent, MonthSheetInput } from './monthSheet';

/**
 * Данные месяца для выгрузки. Места и люди по строкам — из getMonthPlan, как в «Таблице»
 * (со своим plan_row — на месте, остальные — в первые свободные). Сверх неё: все должности
 * справочника (у пустой — строка в листе), комментарии и имена людей без должности.
 */
export async function loadMonthSheet(tx: Tx, month: string): Promise<MonthSheetInput> {
  const positions = (await tx<Array<{ id: string; name: string }>>`
    select id, name from position order by sort_order`).map((p) => ({ id: p.id, name: p.name }));
  const plan = await getMonthPlan(tx, month);
  if (!plan) return { month, positions, events: [] };

  const { from, to } = monthRange(month);
  const extra = await tx<Array<{ id: string; comment: string | null; unplaced: string[] }>>`
    select e.id, e.comment,
           coalesce(array_agg(w.full_name order by w.full_name) filter (where w.id is not null), '{}') as unplaced
    from event e
    left join assignment a on a.event_id = e.id and a.position_id is null
    left join worker w on w.id = a.worker_id
    where e.event_date >= ${from}::date and e.event_date < ${to}::date
    group by e.id`;
  const byEvent = new Map(extra.map((r) => [r.id, r]));

  const events: ExportEvent[] = plan.columns.map((c) => ({
    date: c.date,
    startTime: c.startTime,
    arriveTime: c.arriveTime,
    concert: c.concert,
    tag: c.tag,
    eventTypeName: c.eventTypeName,
    baseRate: c.baseRate,
    comment: byEvent.get(c.eventId)?.comment ?? null,
    places: Object.fromEntries(Object.entries(plan.people[c.eventId] ?? {})
      .map(([positionId, rows]) => [positionId, rows.map((person) => person?.fullName ?? null)])),
    unplaced: byEvent.get(c.eventId)?.unplaced ?? [],
  }));
  return { month, positions, events };
}
