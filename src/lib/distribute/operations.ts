import type { Tx } from '@/db/client';
import { UserError } from '@/lib/errors';
import { monthRange } from '@/lib/month';
import { ADMIN, distribute, type FreeSlot, type Placement, type RandomInt } from './distribute';
import type { DistributionRow } from './rows';

export type DistributionPerson = { workerId: string; fullName: string };
/** Мероприятие, где есть кого и куда ставить: люди без должности и свободные места не-АДМИН. */
export type DistributionEvent = {
  eventId: string; date: string; startTime: string; concert: string | null;
  people: DistributionPerson[]; free: FreeSlot[];
};
export type DistributionPlan = DistributionEvent & { rows: Placement[] };
/** Одно мероприятие (любой даты) или месяц с сегодняшнего дня по Москве. */
export type DistributionScope = { eventId: string } | { month: string; today: string };
export type DistributionResult = { applied: number; skipped: number; eventIds: string[]; months: string[] };

type EventRow = { id: string; date: string; start_time: string; concert: string | null };

async function scopeEvents(tx: Tx, scope: DistributionScope): Promise<EventRow[]> {
  if ('eventId' in scope) {
    const rows = await tx<EventRow[]>`select id, to_char(event_date, 'YYYY-MM-DD') as date, to_char(start_time, 'HH24:MI') as start_time,
      concert from event where id = ${scope.eventId}`;
    if (rows.length === 0) throw new UserError('Мероприятие не найдено — обновите страницу');
    return rows;
  }
  const { from, to } = monthRange(scope.month);
  return tx<EventRow[]>`select id, to_char(event_date, 'YYYY-MM-DD') as date, to_char(start_time, 'HH24:MI') as start_time,
    concert from event where event_date >= greatest(${from}::date, ${scope.today}::date) and event_date < ${to}::date
    order by event_date, start_time, id`;
}

/**
 * Люди без должности (активные, без запроса отмены) и свободные места не-АДМИН по мероприятиям.
 * Мероприятия, где ставить некого или некуда, не попадают. Ничего не пишет.
 */
export async function loadDistribution(tx: Tx, scope: DistributionScope): Promise<DistributionEvent[]> {
  const events = await scopeEvents(tx, scope);
  if (events.length === 0) return [];
  const ids = events.map((e) => e.id);
  const free = await tx<{ event_id: string; position_id: string; name: string; free: number }[]>`
    select s.event_id, s.position_id, p.name, s.quantity - count(a.id)::int as free
    from event_slot s join position p on p.id = s.position_id
    left join assignment a on a.event_id = s.event_id and a.position_id = s.position_id
    where s.event_id in ${tx(ids)} and p.name <> ${ADMIN}
    group by s.event_id, s.position_id, p.name, p.sort_order, s.quantity
    having s.quantity - count(a.id) > 0
    order by p.sort_order`;
  const people = await tx<{ event_id: string; worker_id: string; full_name: string }[]>`
    select a.event_id, a.worker_id, w.full_name
    from assignment a join worker w on w.id = a.worker_id
    where a.event_id in ${tx(ids)} and a.position_id is null and a.cancel_requested_at is null and w.status = 'active'
    order by w.full_name, a.worker_id`;
  return events.map((e) => ({
    eventId: e.id, date: e.date, startTime: e.start_time, concert: e.concert,
    people: people.filter((p) => p.event_id === e.id).map((p) => ({ workerId: p.worker_id, fullName: p.full_name })),
    free: free.filter((s) => s.event_id === e.id).map((s) => ({ positionId: s.position_id, name: s.name, free: s.free })),
  })).filter((e) => e.people.length > 0 && e.free.length > 0);
}

/** Предпросмотр: загрузка и случайный вариант по каждому мероприятию. Ничего не пишет. */
export async function previewDistribution(tx: Tx, scope: DistributionScope, random: RandomInt): Promise<DistributionPlan[]> {
  return (await loadDistribution(tx, scope)).map((e) => ({
    ...e, rows: distribute(e.people.map((p) => p.workerId), e.free, random),
  }));
}

const key = (a: string, b: string) => `${a}:${b}`;

/**
 * Записывает показанное (с правками менеджера) в одной транзакции, проверяя каждую строку заново:
 * человек всё ещё на мероприятии без должности (активный, без запроса отмены), должность не АДМИН,
 * на ней есть место. Не прошедшие проверку строки пропускаются. Строки «без должности» не пишутся.
 * Порядок блокировок — как в применении шаблона вида (`planType`) и assignWorker: мероприятия (for share)
 * по дате и началу (уникальны), затем места (for update, по event_id, position_id) — до подсчёта людей,
 * затем назначения ровно присланных пар «мероприятие — человек». `months` — месяцы всех присланных мероприятий
 * (таблицу стоит обновить и при полном пропуске: состав изменился), `eventIds` — только изменённые.
 */
export async function applyDistribution(tx: Tx, rows: readonly DistributionRow[]): Promise<DistributionResult> {
  const wanted = rows.filter((r): r is DistributionRow & { positionId: string } => r.positionId !== null);
  if (wanted.length === 0) return { applied: 0, skipped: 0, eventIds: [], months: [] };
  const ids = [...new Set(wanted.map((r) => r.eventId))].sort();
  const pairs = [...new Map(wanted.map((r) => [key(r.eventId, r.workerId), r])).values()]
    .sort((a, b) => a.eventId.localeCompare(b.eventId) || a.workerId.localeCompare(b.workerId));

  const events = await tx<{ id: string; month: string }[]>`
    select id, to_char(event_date, 'YYYY-MM') as month from event where id in ${tx(ids)} order by event_date, start_time for share`;
  const slots = await tx<{ event_id: string; position_id: string; quantity: number }[]>`
    select event_id, position_id, quantity from event_slot where event_id in ${tx(ids)}
    order by event_id, position_id for update`;
  const people = await tx<{ event_id: string; worker_id: string; position_id: string | null; ready: boolean }[]>`
    select a.event_id, a.worker_id, a.position_id, (a.cancel_requested_at is null and w.status = 'active') as ready
    from assignment a join worker w on w.id = a.worker_id
    where (a.event_id, a.worker_id) in (
      select * from unnest(${pairs.map((p) => p.eventId)}::uuid[], ${pairs.map((p) => p.workerId)}::uuid[]))
    order by a.event_id, a.worker_id for update of a`;
  const taken = await tx<{ event_id: string; position_id: string; people: number }[]>`
    select event_id, position_id, count(*)::int as people from assignment
    where event_id in ${tx(ids)} and position_id is not null group by event_id, position_id`;
  const admin = new Set((await tx<{ id: string }[]>`select id from position where name = ${ADMIN}`).map((p) => p.id));

  const monthOf = new Map(events.map((e) => [e.id, e.month]));
  const room = new Map(slots.map((s) => [key(s.event_id, s.position_id), s.quantity]));
  for (const t of taken) {
    const k = key(t.event_id, t.position_id);
    room.set(k, (room.get(k) ?? 0) - t.people);
  }
  const waiting = new Set(people.filter((p) => p.position_id === null && p.ready).map((p) => key(p.event_id, p.worker_id)));

  let applied = 0;
  const touched = new Set<string>();
  for (const r of wanted) {
    const seat = key(r.eventId, r.positionId);
    const person = key(r.eventId, r.workerId);
    if (!monthOf.has(r.eventId) || admin.has(r.positionId) || (room.get(seat) ?? 0) <= 0 || !waiting.has(person)) continue;
    await tx`update assignment set position_id = ${r.positionId}
      where event_id = ${r.eventId} and worker_id = ${r.workerId} and position_id is null`;
    room.set(seat, (room.get(seat) ?? 0) - 1);
    waiting.delete(person);
    touched.add(r.eventId);
    applied += 1;
  }
  const eventIds = [...touched];
  return {
    applied, skipped: wanted.length - applied, eventIds,
    months: [...new Set(monthOf.values())].sort(),
  };
}
