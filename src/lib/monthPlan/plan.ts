import type { Tx } from '@/db/client';
import type { EventTag } from '@/lib/import/parseSheet';
import { eventTypeOptions } from '@/lib/eventTypes/operations';
import type { EventTypeOption } from '@/lib/eventTypes/types';
import { UserError } from '@/lib/errors';
import { monthRange } from '@/lib/month';
import { assignWorker, unassignWorker } from '@/app/(manager)/event/[id]/operations';
import { monthInfo, type MonthStatus } from './months';

export type PlanColumn = {
  eventId: string; date: string; startTime: string; arriveTime: string | null; arriveManual: boolean;
  concert: string | null; tag: EventTag; eventTypeId: string; eventTypeName: string; baseRate: number | null;
};
export type PlanPerson = { workerId: string; fullName: string };
export type PlanPosition = { id: string; name: string; rows: number };
export type MonthPlan = {
  month: string;
  status: MonthStatus | null;
  columns: PlanColumn[];
  eventTypeOptions: EventTypeOption[];
  /** Только должности, у которых хоть на одном мероприятии есть места или люди. */
  positions: PlanPosition[];
  /** eventId → positionId → мест. */
  quantity: Record<string, Record<string, number>>;
  /** eventId → positionId → люди по строкам (null — пустая строка). */
  people: Record<string, Record<string, Array<PlanPerson | null>>>;
  /** eventId → работники без должности (в таблице не видны, но заняты). */
  unplaced: Record<string, string[]>;
  /** Активные работники по алфавиту — для подсказок. */
  workers: PlanPerson[];
  /** eventId → подавшие заявку, по времени подачи. */
  signups: Record<string, string[]>;
};

type Placed = PlanPerson & { planRow: number | null };

/** Люди должности по строкам: со своим номером — на месте, остальные — в первые свободные, лишние — в конец. */
export function placePeople(people: Placed[], quantity: number): Array<PlanPerson | null> {
  const rows: Array<PlanPerson | null> = Array.from({ length: quantity }, () => null);
  const rest: PlanPerson[] = [];
  for (const { planRow, ...person } of people) {
    if (planRow !== null && planRow < quantity && rows[planRow] === null) rows[planRow] = person;
    else rest.push(person);
  }
  for (const person of rest) {
    const free = rows.indexOf(null);
    if (free >= 0) rows[free] = person;
    else rows.push(person);
  }
  return rows;
}

export async function getMonthPlan(tx: Tx, month: string): Promise<MonthPlan | null> {
  const info = await monthInfo(tx, month);
  if (info.status === null && info.events === 0) return null;
  const { from, to } = monthRange(month);

  const events = await tx<Array<{
    id: string; event_date: string; start_time: string; arrive_time: string | null; arrive_manual: boolean;
    concert: string | null; tag: EventTag; event_type_id: string; event_type_name: string; base_rate: number | null;
  }>>`
    select e.id, to_char(event_date, 'YYYY-MM-DD') as event_date, to_char(start_time, 'HH24:MI') as start_time,
           to_char(arrive_time, 'HH24:MI') as arrive_time, arrive_manual, concert, tag::text as tag, base_rate, event_type_id, t.name as event_type_name
    from event e join event_type t on t.id=e.event_type_id where event_date >= ${from}::date and event_date < ${to}::date
    order by event_date, start_time`;
  const positions = await tx<Array<{ id: string; name: string }>>`
    select id, name from position order by sort_order`;
  const slots = await tx<Array<{ event_id: string; position_id: string; quantity: number }>>`
    select s.event_id, s.position_id, s.quantity
    from event_slot s join event e on e.id = s.event_id
    where e.event_date >= ${from}::date and e.event_date < ${to}::date`;
  const assigned = await tx<Array<{
    event_id: string; position_id: string | null; worker_id: string; full_name: string; plan_row: number | null;
  }>>`
    select a.event_id, a.position_id, a.worker_id, w.full_name, a.plan_row
    from assignment a join worker w on w.id = a.worker_id join event e on e.id = a.event_id
    where e.event_date >= ${from}::date and e.event_date < ${to}::date
    order by a.created_at, w.full_name`;
  const workers = await tx<Array<{ id: string; full_name: string }>>`
    select id, full_name from worker where status = 'active' order by full_name`;
  const signups = await tx<Array<{ event_id: string; worker_id: string }>>`
    select g.event_id, g.worker_id from signup g join event e on e.id = g.event_id
    where g.status = 'pending' and e.event_date >= ${from}::date and e.event_date < ${to}::date
    order by g.created_at`;

  const quantity: MonthPlan['quantity'] = {};
  for (const s of slots) (quantity[s.event_id] ??= {})[s.position_id] = s.quantity;

  const byCell = new Map<string, Placed[]>();
  const unplaced: MonthPlan['unplaced'] = {};
  for (const a of assigned) {
    if (a.position_id === null) {
      (unplaced[a.event_id] ??= []).push(a.worker_id);
      continue;
    }
    const key = `${a.event_id}:${a.position_id}`;
    byCell.set(key, [...(byCell.get(key) ?? []), { workerId: a.worker_id, fullName: a.full_name, planRow: a.plan_row }]);
  }

  const people: MonthPlan['people'] = {};
  const rows = new Map<string, number>();
  for (const e of events) {
    people[e.id] = {};
    for (const p of positions) {
      const placed = placePeople(byCell.get(`${e.id}:${p.id}`) ?? [], quantity[e.id]?.[p.id] ?? 0);
      if (placed.length > 0) people[e.id][p.id] = placed;
      rows.set(p.id, Math.max(rows.get(p.id) ?? 0, placed.length));
    }
  }

  const signupMap: MonthPlan['signups'] = {};
  for (const s of signups) (signupMap[s.event_id] ??= []).push(s.worker_id);

  return {
    month,
    status: info.status,
    eventTypeOptions: await eventTypeOptions(tx),
    columns: events.map((e) => ({
      eventId: e.id, date: e.event_date, startTime: e.start_time, arriveTime: e.arrive_time,
      arriveManual: e.arrive_manual, concert: e.concert, tag: e.tag, eventTypeId:e.event_type_id, eventTypeName:e.event_type_name, baseRate: e.base_rate,
    })),
    positions: positions
      .filter((p) => (rows.get(p.id) ?? 0) > 0)
      .map((p) => ({ id: p.id, name: p.name, rows: rows.get(p.id) ?? 0 })),
    quantity,
    people,
    unplaced,
    workers: workers.map((w) => ({ workerId: w.id, fullName: w.full_name })),
    signups: signupMap,
  };
}

/** Верхняя граница номера строки должности — защита от мусора из браузера. */
export const MAX_PLAN_ROW = 40;

/**
 * Ячейка таблицы: previousWorkerId — кто стоял, workerId — кого поставить
 * (null — очистить). Человек, уже стоящий на этом мероприятии, не ставится.
 * Вписанный из подавших заявку — заявка принимается.
 */
export async function setPlanCell(
  tx: Tx,
  { eventId, positionId, row, previousWorkerId, workerId }: {
    eventId: string; positionId: string; row: number; previousWorkerId: string | null; workerId: string | null;
  },
): Promise<void> {
  if (!Number.isInteger(row) || row < 0 || row > MAX_PLAN_ROW) throw new UserError('Некорректная строка таблицы');
  if (workerId !== null && workerId === previousWorkerId) return;
  if (workerId !== null) {
    const [already] = await tx<{ name: string | null }[]>`
      select p.name from assignment a left join position p on p.id = a.position_id
      where a.event_id = ${eventId} and a.worker_id = ${workerId}`;
    if (already) throw new UserError(`Уже на этом мероприятии: ${already.name ?? 'без должности'}`);
  }
  if (previousWorkerId !== null) {
    // Таблица в браузере могла устареть: снимаем прежнего человека, только если он стоит именно здесь.
    const [onCell] = await tx<{ id: string }[]>`
      select id from assignment
      where event_id = ${eventId} and worker_id = ${previousWorkerId} and position_id = ${positionId}`;
    if (!onCell) throw new UserError('Ячейка изменилась — обновите страницу');
    await unassignWorker(tx, { eventId, workerId: previousWorkerId });
  }
  if (workerId === null) return;
  await assignWorker(tx, { eventId, workerId, positionId });
  await tx`update assignment set plan_row = ${row} where event_id = ${eventId} and worker_id = ${workerId}`;
  await tx`update signup set status = 'accepted'
           where event_id = ${eventId} and worker_id = ${workerId} and status = 'pending'`;
}
