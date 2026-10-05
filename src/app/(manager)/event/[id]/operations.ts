import type { Tx } from '@/db/client';
import { UserError } from '@/lib/errors';
import { checkQuantity } from '@/lib/quantity';
import { eventTypeOptions, resolveEventType } from '@/lib/eventTypes/operations';
import type { EventTypeOption } from '@/lib/eventTypes/types';

export type Person = {
  workerId: string;
  fullName: string;
  personRate: number | null;
  cancelRequested: boolean;
};

export type SlotView = {
  positionId: string;
  name: string;
  quantity: number;
  rate: number | null;
  typeRate: number | null;
  defaultRate: number | null;
  people: Person[];
};

export type EventCard = {
  event: {
    id: string; date: string; startTime: string; arriveTime: string | null;
    concert: string | null; tag: string; eventTypeId: string; eventTypeName: string; baseRate: number | null; comment: string | null; program: string | null; performers: string | null;
  };
  eventTypeOptions: EventTypeOption[];
  slots: SlotView[];
  unplaced: Person[];
  signups: Array<{ signupId: string; workerId: string; fullName: string }>;
  available: Array<{ id: string; fullName: string }>;
};

export async function getEventCard(tx: Tx, eventId: string): Promise<EventCard | null> {
  const [event] = await tx<Array<{
    id: string; event_date: string; start_time: string; arrive_time: string | null;
    concert: string | null; tag: string; event_type_id: string; event_type_name: string; base_rate: number | null; comment: string | null; program: string | null; performers: string | null;
  }>>`
    select e.id, to_char(event_date, 'YYYY-MM-DD') as event_date,
           to_char(start_time, 'HH24:MI') as start_time,
           to_char(arrive_time, 'HH24:MI') as arrive_time,
           concert, program, performers, tag::text as tag, base_rate, comment, event_type_id, t.name as event_type_name
    from event e join event_type t on t.id=e.event_type_id where e.id = ${eventId}`;
  if (!event) return null;

  const slots = await tx<Array<{
    position_id: string; name: string; quantity: number; rate: number | null;
    default_rate: number | null; type_rate: number | null;
  }>>`
    select p.id as position_id, p.name, coalesce(s.quantity, 0) as quantity,
           s.rate, case when s.event_id is null and e.event_date + e.start_time > localtimestamp
             then t.rate else s.type_rate end as type_rate, p.default_rate
    from position p
    left join event_slot s on s.position_id = p.id and s.event_id = ${eventId}
    left join event e on e.id=${eventId}
    left join event_type_slot t on t.event_type_id=e.event_type_id and t.position_id=p.id
    order by p.sort_order`;

  const people = await tx<Array<{
    worker_id: string; full_name: string; position_id: string | null;
    rate: number | null; cancel_requested: boolean;
  }>>`
    select a.worker_id, w.full_name, a.position_id, a.rate,
           a.cancel_requested_at is not null as cancel_requested
    from assignment a join worker w on w.id = a.worker_id
    where a.event_id = ${eventId}
    order by w.full_name`;

  const signups = await tx<Array<{ id: string; worker_id: string; full_name: string }>>`
    select g.id, g.worker_id, w.full_name
    from signup g join worker w on w.id = g.worker_id
    where g.event_id = ${eventId} and g.status = 'pending'
    order by g.created_at`;

  const available = await tx<Array<{ id: string; full_name: string }>>`
    select w.id, w.full_name from worker w
    where w.status = 'active'
      and not exists (select 1 from assignment a where a.event_id = ${eventId} and a.worker_id = w.id)
    order by w.full_name`;

  const toPerson = (p: (typeof people)[number]): Person => ({
    workerId: p.worker_id, fullName: p.full_name,
    personRate: p.rate, cancelRequested: p.cancel_requested,
  });

  return {
    event: {
      id: event.id, date: event.event_date, startTime: event.start_time,
      arriveTime: event.arrive_time, concert: event.concert, tag: event.tag,
      baseRate: event.base_rate, comment: event.comment, program: event.program, performers: event.performers, eventTypeId: event.event_type_id, eventTypeName: event.event_type_name,
    },
    eventTypeOptions: await eventTypeOptions(tx,event.event_type_id),
    slots: slots.map((s) => ({
      positionId: s.position_id, name: s.name, quantity: s.quantity,
      rate: s.rate, typeRate: s.type_rate, defaultRate: s.default_rate,
      people: people.filter((p) => p.position_id === s.position_id).map(toPerson),
    })),
    unplaced: people.filter((p) => p.position_id === null).map(toPerson),
    signups: signups.map((s) => ({ signupId: s.id, workerId: s.worker_id, fullName: s.full_name })),
    available: available.map((w) => ({ id: w.id, fullName: w.full_name })),
  };
}

export async function setSlot(
  tx: Tx,
  { eventId, positionId, quantity, rate }:
    { eventId: string; positionId: string; quantity: number; rate: number | null },
): Promise<void> {
  checkQuantity(quantity);
  const [event] = await tx<{event_type_id:string}[]>`select event_type_id from event where id=${eventId}`;
  if (!event) throw new UserError('Мероприятие не найдено — обновите страницу');
  await resolveEventType(tx, {id:event.event_type_id,currentTypeId:event.event_type_id});
  const [locked] = await tx<{event_type_id:string}[]>`select event_type_id from event where id=${eventId} for share`;
  if (!locked || locked.event_type_id!==event.event_type_id) throw new UserError('Мероприятие изменилось — обновите страницу');
  const [slot] = await tx<{ inserted: boolean }[]>`
    insert into event_slot (event_id, position_id, quantity, rate)
    values (${eventId}, ${positionId}, ${quantity}, ${rate})
    on conflict (event_id, position_id)
      do update set quantity = excluded.quantity, rate = excluded.rate
    returning (xmax = 0) as inserted`;
  // Новое место на уже начавшемся (или прошедшем) мероприятии — без нынешней ставки вида: прошлую оплату
  // не меняем. Триггер inherit_slot_type_rate снимок заполнил — убираем. Часы — базы, как у ставок вида.
  if (slot.inserted) {
    await tx`update event_slot set type_rate = null
      where event_id = ${eventId} and position_id = ${positionId}
        and exists (select 1 from event e where e.id = ${eventId} and e.event_date + e.start_time <= localtimestamp)`;
  }
}

/**
 * Назначать можно только активного работника.
 * Блокировка строки слота не даёт двоим одновременно занять последнее место:
 * вторая транзакция ждёт первую и затем видит её запись.
 */
export async function assignWorker(
  tx: Tx,
  { eventId, workerId, positionId }:
    { eventId: string; workerId: string; positionId: string | null },
): Promise<void> {
  // Мероприятие до места: его правка и применение шаблона берут тот же порядок.
  const [event] = await tx`select id from event where id=${eventId} for share`;
  if (!event) throw new UserError('Мероприятие не найдено — обновите страницу');
  const [worker] = await tx<{ status: string }[]>`
    select status::text as status from worker where id = ${workerId}`;
  if (!worker) throw new UserError('Работник не найден — обновите страницу');
  if (worker.status !== 'active') throw new UserError('Работник в архиве');

  if (positionId !== null) {
    const [slot] = await tx<{ quantity: number }[]>`
      select quantity from event_slot
      where event_id = ${eventId} and position_id = ${positionId}
      for update`;
    const [{ taken }] = await tx<{ taken: number }[]>`
      select count(*)::int as taken from assignment
      where event_id = ${eventId} and position_id = ${positionId} and worker_id <> ${workerId}`;
    if (!slot || taken >= slot.quantity) {
      throw new UserError('На этой должности мест нет — увеличьте количество');
    }
  }

  await tx`
    insert into assignment (worker_id, event_id, position_id)
    values (${workerId}, ${eventId}, ${positionId})
    on conflict (worker_id, event_id) do update set position_id = excluded.position_id`;
}

/** Текст ошибки при гонке: действие целилось в запись, которую уже убрали. */
export const PERSON_GONE = 'Человека уже нет на этом событии — обновите страницу';
/** Заявку уже приняли или отклонили (в приложении или кнопкой бота). */
export const SIGNUP_HANDLED = 'Заявка уже обработана';

export async function unassignWorker(
  tx: Tx, { eventId, workerId }: { eventId: string; workerId: string },
): Promise<void> {
  const [row] = await tx<{ id: string }[]>`
    delete from assignment where event_id = ${eventId} and worker_id = ${workerId}
    returning id`;
  if (!row) throw new UserError(PERSON_GONE);
  // Иначе заявка остаётся «принята» без назначения — тупик: работнику
  // нельзя ни подать новую заявку (уже есть строка), ни увидеть событие
  // в свободных. Как и resolveCancel(approve: true).
  await tx`delete from signup where event_id = ${eventId} and worker_id = ${workerId}`;
}

export async function setPersonRate(
  tx: Tx,
  { eventId, workerId, rate }: { eventId: string; workerId: string; rate: number | null },
): Promise<void> {
  const [row] = await tx<{ id: string }[]>`
    update assignment set rate = ${rate}
    where event_id = ${eventId} and worker_id = ${workerId}
    returning id`;
  if (!row) throw new UserError(PERSON_GONE);
}

export async function acceptSignup(
  tx: Tx, { signupId, positionId }: { signupId: string; positionId: string | null },
): Promise<void> {
  const [signup] = await tx<{ worker_id: string; event_id: string }[]>`
    update signup set status = 'accepted'
    where id = ${signupId} and status = 'pending'
    returning worker_id, event_id`;
  if (!signup) throw new UserError(SIGNUP_HANDLED);
  await assignWorker(tx, { eventId: signup.event_id, workerId: signup.worker_id, positionId });
}

export async function rejectSignup(tx: Tx, signupId: string): Promise<void> {
  const [row] = await tx<{ id: string }[]>`
    update signup set status = 'rejected' where id = ${signupId} and status = 'pending'
    returning id`;
  if (!row) throw new UserError(SIGNUP_HANDLED);
}

export async function resolveCancel(
  tx: Tx,
  { eventId, workerId, approve }: { eventId: string; workerId: string; approve: boolean },
): Promise<void> {
  // Строго true: аргументы action приходят из браузера, строка "false" истинна.
  if (approve === true) {
    // Заявки может не быть вовсе — человека могли добавить вручную без неё,
    // поэтому её удаление 0 строк не проверяем, только удаление assignment.
    const [row] = await tx<{ id: string }[]>`
      delete from assignment where event_id = ${eventId} and worker_id = ${workerId}
      returning id`;
    if (!row) throw new UserError(PERSON_GONE);
    await tx`delete from signup where event_id = ${eventId} and worker_id = ${workerId}`;
  } else {
    const [row] = await tx<{ id: string }[]>`
      update assignment set cancel_requested_at = null
      where event_id = ${eventId} and worker_id = ${workerId}
      returning id`;
    if (!row) throw new UserError(PERSON_GONE);
  }
}
