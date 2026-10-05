import type { Tx } from '@/db/client';
import { rateRange, type RateRange } from './calculatePay';

/**
 * Ставки, которые работник получит на мероприятиях (`rateRange`): уровни мест (ручная ставка места,
 * затем снимок ставки вида; общая ставка должности) и базовая ставка мероприятия — одним запросом.
 * RLS работника пропускает места опубликованных мероприятий и должности.
 */
export async function eventRateRanges(tx: Tx, eventIds: readonly string[]): Promise<Map<string, RateRange | null>> {
  if (eventIds.length === 0) return new Map();
  const rows = await tx<Array<{ id: string; base_rate: number | null; has_slot: boolean; slot_rate: number | null; position_rate: number | null }>>`
    select e.id, e.base_rate, s.event_id is not null as has_slot,
           coalesce(s.rate, s.type_rate) as slot_rate, p.default_rate as position_rate
    from event e
    left join event_slot s on s.event_id = e.id and s.quantity > 0
    left join position p on p.id = s.position_id
    where e.id in ${tx([...eventIds])}`;
  const byEvent = new Map<string, { base: number | null; slots: Array<{ slotRate: number | null; positionRate: number | null }> }>();
  for (const r of rows) {
    const entry = byEvent.get(r.id) ?? { base: r.base_rate, slots: [] };
    if (r.has_slot) entry.slots.push({ slotRate: r.slot_rate, positionRate: r.position_rate });
    byEvent.set(r.id, entry);
  }
  return new Map([...byEvent].map(([id, e]) => [id, rateRange(e.slots, e.base)]));
}
