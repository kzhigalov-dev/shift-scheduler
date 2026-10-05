import type { Tx } from '@/db/client';
import { calculatePay, shiftAmount, type PayRow } from '@/lib/pay/calculatePay';
import { monthRange } from '@/lib/month';

export type PayDetail = {
  date: string;
  concert: string | null;
  fullName: string;
  position: string | null;
  amount: number | null;
};

/** Сводка и детализация оплаты за месяц: ставка — первая заполненная от личной до ставки концерта. */
export async function payForMonth(
  tx: Tx, month: string,
): Promise<{ rows: PayRow[]; details: PayDetail[] }> {
  const { from, to } = monthRange(month);
  const raw = await tx<Array<{
    worker_id: string; full_name: string; event_date: string; concert: string | null;
    position: string | null; person_rate: number | null; slot_rate: number | null;
    position_rate: number | null; event_rate: number | null;
  }>>`
    select a.worker_id, w.full_name,
           to_char(e.event_date, 'YYYY-MM-DD') as event_date, e.concert,
           p.name as position,
           a.rate as person_rate, coalesce(s.rate,s.type_rate) as slot_rate,
           p.default_rate as position_rate, e.base_rate as event_rate
    from assignment a
    join event e on e.id = a.event_id
    join worker w on w.id = a.worker_id
    left join position p on p.id = a.position_id
    left join event_slot s on s.event_id = a.event_id and s.position_id = a.position_id
    where e.event_date >= ${from}::date and e.event_date < ${to}::date
    order by e.event_date, e.start_time, p.sort_order nulls last, w.full_name`;

  const inputs = raw.map((r) => ({
    workerId: r.worker_id, fullName: r.full_name,
    personRate: r.person_rate, slotRate: r.slot_rate,
    positionRate: r.position_rate, eventRate: r.event_rate,
  }));

  return {
    rows: calculatePay(inputs),
    details: raw.map((r, i) => ({
      date: r.event_date, concert: r.concert, fullName: r.full_name,
      position: r.position, amount: shiftAmount(inputs[i]),
    })),
  };
}
