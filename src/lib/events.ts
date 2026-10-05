import postgres from 'postgres';
import type { Tx } from '@/db/client';
import type { EventTag } from '@/lib/import/parseSheet';
import { EVENT_TAGS } from '@/lib/eventTags';
import { resolveEventType, copyEventTypeSlots, refreshEventTypeRate } from '@/lib/eventTypes/operations';
import { isUuid } from '@/lib/ids';
import { UserError } from '@/lib/errors';
import { resolveArrive } from '@/lib/schedule/rules';

export type EventInput = {
  date: string;
  startTime: string;
  arriveTime: string | null;
  concert: string | null;
  tag: EventTag;
  eventTypeId?: string;
  baseRate: number | null;
  comment: string | null;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `9:30`, `9.30`, `09:30` → `09:30`; неверное — null. Ввод в ячейках таблицы. */
export function normalizeTime(value: string): string | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(value.trim());
  if (!m) return null;
  const time = `${m[1].padStart(2, '0')}:${m[2]}`;
  return TIME_RE.test(time) ? time : null;
}

export type EventField = 'startTime' | 'arriveTime' | 'baseRate';
const EVENT_FIELDS: readonly string[] = ['startTime', 'arriveTime', 'baseRate'];

export function isEventField(value: string): value is EventField {
  return EVENT_FIELDS.includes(value);
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Верхняя граница ставки за смену — защита от опечатки лишним нулём. */
export const MAX_RATE = 1_000_000;

/** Пусто — «не задано». Иначе целое неотрицательное число рублей, не больше MAX_RATE. */
export function parseRate(value: FormDataEntryValue | null): number | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  if (!/^\d+$/.test(s)) throw new UserError(`Ставка должна быть целым числом рублей, получено «${s}»`);
  const n = Number(s);
  if (n > MAX_RATE) throw new UserError('Ставка больше 1 000 000 ₽ — проверьте число');
  return n;
}

export function parseEventForm(form: FormData): EventInput {
  const date = field(form, 'date');
  const probe = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(probe.getTime())
      || probe.toISOString().slice(0, 10) !== date) {
    throw new UserError('Неверная дата');
  }
  const startTime = field(form, 'startTime');
  if (!TIME_RE.test(startTime)) throw new UserError('Неверное время начала');
  const arriveTime = field(form, 'arriveTime') || null;
  if (arriveTime && !TIME_RE.test(arriveTime)) throw new UserError('Неверное время прихода');
  const tag = field(form, 'tag') || 'regular';
  if (!EVENT_TAGS.includes(tag as EventTag)) throw new UserError('Неизвестный тип события');

  const eventTypeId = field(form, 'eventTypeId') || undefined;
  if (eventTypeId !== undefined && !isUuid(eventTypeId)) throw new UserError('Некорректный вид мероприятия');
  return {
    eventTypeId,
    date,
    startTime,
    arriveTime,
    concert: field(form, 'concert') || null,
    tag: tag as EventTag,
    baseRate: parseRate(form.get('baseRate')),
    comment: field(form, 'comment') || null,
  };
}

function friendly(error: unknown): never {
  if (error instanceof postgres.PostgresError && error.code === '23505') {
    throw new UserError('На это время уже есть событие');
  }
  throw error;
}

const EVENT_GONE = 'Событие не найдено — обновите страницу';

export async function createEvent(tx: Tx, input: EventInput): Promise<string> {
  const type = await resolveEventType(tx, input.eventTypeId !== undefined ? { id: input.eventTypeId } : { systemTag: input.tag });
  const tag = type.systemTag ?? 'regular';
  const arrive = resolveArrive(null, { startTime: input.startTime, arriveTime: input.arriveTime, tag });
  try {
    const [row] = await tx.savepoint((sp) => sp<{ id: string }[]>`
      insert into event (event_date, start_time, arrive_time, arrive_manual, concert, tag, event_type_id, base_rate, comment)
      values (${input.date}, ${input.startTime}, ${arrive.arriveTime}, ${arrive.manual}, ${input.concert},
              ${tag}, ${type.id}, ${input.baseRate}, ${input.comment})
      returning id`);
    await copyEventTypeSlots(tx, row.id, type.id);
    return row.id;
  } catch (error) {
    return friendly(error);
  }
}

type ArriveRow = { start_time: string; arrive_time: string | null; arrive_manual: boolean; tag: EventTag; event_type_id: string };

async function lockArrive(tx: Tx, id: string): Promise<ArriveRow> {
  const [row] = await tx<ArriveRow[]>`
    select to_char(start_time, 'HH24:MI') as start_time, to_char(arrive_time, 'HH24:MI') as arrive_time,
           arrive_manual, tag::text as tag, event_type_id
    from event where id = ${id} for update`;
  if (!row) throw new UserError(EVENT_GONE);
  return row;
}

const arriveState = (row: ArriveRow) =>
  ({ startTime: row.start_time, arriveTime: row.arrive_time, manual: row.arrive_manual });

export async function updateEvent(tx: Tx, id: string, input: EventInput): Promise<void> {
  // Сначала вид, затем мероприятие: сохранение ставок вида блокирует в том же порядке.
  const [found] = await tx<{ event_type_id: string }[]>`select event_type_id from event where id=${id}`;
  if (!found) throw new UserError(EVENT_GONE);
  const type = await resolveEventType(tx, input.eventTypeId !== undefined
    ? { id: input.eventTypeId, currentTypeId: found.event_type_id }
    : { systemTag: input.tag, currentTypeId: found.event_type_id });
  const current = await lockArrive(tx, id);
  if (type.archived && type.id !== current.event_type_id) throw new UserError('Вид находится в архиве — выберите другой');
  const tag = type.systemTag ?? 'regular';
  const arrive = resolveArrive(arriveState(current),
    { startTime: input.startTime, arriveTime: input.arriveTime, tag });
  try {
    await tx.savepoint(async sp => {
      await sp`update event set event_date = ${input.date}, start_time = ${input.startTime},
        arrive_time = ${arrive.arriveTime}, arrive_manual = ${arrive.manual},
        concert = ${input.concert}, tag = ${tag}, event_type_id = ${type.id},
        base_rate = ${input.baseRate}, comment = ${input.comment}
      where id = ${id}`;
      await refreshEventTypeRate(sp,id,type.id);
    });
  } catch (error) {
    friendly(error);
  }
}

/** Правка одной ячейки таблицы расстановки: начало, приход или ставка. */
export async function setEventField(tx: Tx, id: string, field: EventField, raw: string): Promise<void> {
  const value = raw.trim();
  const current = await lockArrive(tx, id);
  if (field === 'baseRate') {
    await tx`update event set base_rate = ${parseRate(value)} where id = ${id}`;
    return;
  }
  if (field === 'startTime') {
    const startTime = normalizeTime(value);
    if (!startTime) throw new UserError('Неверное время начала');
    const arrive = resolveArrive(arriveState(current),
      { startTime, arriveTime: current.arrive_time, tag: current.tag });
    try {
      await tx.savepoint((sp) => sp`
        update event set start_time = ${startTime}, arrive_time = ${arrive.arriveTime},
          arrive_manual = ${arrive.manual}
        where id = ${id}`);
    } catch (error) {
      friendly(error);
    }
    return;
  }
  const arriveTime = value ? normalizeTime(value) : null;
  if (value && !arriveTime) throw new UserError('Неверное время прихода');
  const arrive = resolveArrive(arriveState(current),
    { startTime: current.start_time, arriveTime, tag: current.tag });
  await tx`update event set arrive_time = ${arrive.arriveTime}, arrive_manual = ${arrive.manual} where id = ${id}`;
}

export async function deleteEvent(tx: Tx, id: string): Promise<void> {
  const rows = await tx<{ id: string }[]>`delete from event where id = ${id} returning id`;
  if (rows.length === 0) throw new UserError(EVENT_GONE);
}
