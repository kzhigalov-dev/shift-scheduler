import postgres from 'postgres';
import type { Tx } from '@/db/client';
import type { EventTag } from '@/lib/import/parseSheet';
import type { ScheduleEvent } from '@/lib/schedule/parseSchedule';
import { resolveArrive } from '@/lib/schedule/rules';
import type { ExistingEvent, ScheduleDiff } from '@/lib/schedule/diff';
import { resolveEventType, copyEventTypeSlots } from '@/lib/eventTypes/operations';
import { UserError } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { monthRange } from '@/lib/month';

export type MonthStatus = 'draft' | 'published';
export type MonthInfo = { status: MonthStatus | null; events: number };

export async function monthInfo(tx: Tx, month: string): Promise<MonthInfo> {
  const { from, to } = monthRange(month);
  const [row] = await tx<MonthInfo[]>`
    select (select status::text from month where month = ${month}) as status,
           (select count(*) from event
             where event_date >= ${from}::date and event_date < ${to}::date)::int as events`;
  return row;
}

/** Ставка по умолчанию: последнее по дате мероприятие того же типа из прошлых месяцев. */
export async function defaultBaseRates(tx: Tx, month: string): Promise<Record<string, number>> {
  const rows = await tx<{ event_type_id: string; base_rate: number }[]>`
    select distinct on (event_type_id) event_type_id, base_rate from event
    where event_date < ${monthRange(month).from}::date and base_rate is not null
    order by event_type_id, event_date desc, start_time desc`;
  return Object.fromEntries(rows.map((r) => [r.event_type_id, r.base_rate]));
}

export type NewScheduleEvent = Pick<ScheduleEvent, 'date' | 'startTime' | 'title' | 'tag' | 'arriveTime' | 'comment'>;

/** Мероприятия из расписания с местами по шаблону должностей. Приход — автоматический. */
export async function insertScheduleEvents(tx: Tx, month: string, events: NewScheduleEvent[]): Promise<number> {
  const rates = await defaultBaseRates(tx, month);
  for (const e of events) {
    if (!e.date.startsWith(`${month}-`)) throw new UserError('Мероприятие не из этого месяца');
    const type = await resolveEventType(tx,{systemTag:e.tag});
    const [row] = await tx<{ id: string }[]>`
      insert into event (event_date, start_time, arrive_time, arrive_manual, concert, source_title,
                         tag, event_type_id, base_rate, comment)
      values (${e.date}, ${e.startTime}, ${e.arriveTime}, false, ${e.title || null}, ${e.title},
              ${e.tag}, ${type.id}, ${rates[type.id] ?? null}, ${e.comment})
      on conflict (event_date, start_time) do nothing
      returning id`;
    if (!row) throw new UserError(`${formatDate(e.date)} в ${e.startTime} уже есть мероприятие`);
    await copyEventTypeSlots(tx,row.id,type.id);
  }
  return events.length;
}

/**
 * Новый месяц — черновиком. Месяц без мероприятий считается новым, даже
 * если запись уже есть (события удалили): она снова становится черновиком.
 */
export async function createDraftMonth(tx: Tx, month: string, events: NewScheduleEvent[]): Promise<void> {
  const info = await monthInfo(tx, month);
  if (info.events > 0) throw new UserError('Этот месяц уже создан — откройте его таблицу');
  await tx`
    insert into month (month, status, published_at) values (${month}, 'draft', null)
    on conflict (month) do update set status = 'draft', published_at = null`;
  await insertScheduleEvents(tx, month, events);
}

/** Публикация черновика. Возвращает число мероприятий месяца. */
export async function publishMonth(tx: Tx, month: string): Promise<number> {
  const [row] = await tx<{ month: string }[]>`
    update month set status = 'published', published_at = now()
    where month = ${month} and status = 'draft'
    returning month`;
  if (!row) throw new UserError('Месяц уже опубликован');
  return (await monthInfo(tx, month)).events;
}

export async function existingForDiff(tx: Tx, month: string): Promise<ExistingEvent[]> {
  const { from, to } = monthRange(month);
  const rows = await tx<Array<{ id: string; event_date: string; start_time: string; source_title: string | null; people: number }>>`
    select e.id, to_char(e.event_date, 'YYYY-MM-DD') as event_date, to_char(e.start_time, 'HH24:MI') as start_time,
           e.source_title, (select count(*) from assignment a where a.event_id = e.id)::int as people
    from event e
    where e.event_date >= ${from}::date and e.event_date < ${to}::date
    order by e.event_date, e.start_time`;
  return rows.map((r) => ({ id: r.id, date: r.event_date, startTime: r.start_time, sourceTitle: r.source_title, people: r.people }));
}

export type DiffSelection = { add: string[]; change: string[]; remove: string[] };

/**
 * Применяет отмеченное из разницы. Изменённое: начало, исходное название;
 * приход пересчитывается от нового начала по текущему типу, если не правлен
 * руками; название на экране меняется, только если менеджер его не
 * переименовывал. Тип и комментарий, выставленные менеджером, не трогаются.
 * Люди остаются.
 */
export async function applyScheduleDiff(
  tx: Tx, month: string, diff: ScheduleDiff, selection: DiffSelection,
): Promise<{ added: number; changed: number; removed: number }> {
  const added = await insertScheduleEvents(tx, month, diff.added.filter((e) => selection.add.includes(e.key)));

  let changed = 0;
  for (const c of diff.changed.filter((x) => selection.change.includes(x.eventId))) {
    const [cur] = await tx<Array<{ start_time: string; arrive_time: string | null; arrive_manual: boolean; concert: string | null; source_title: string | null; concert_details_imported: boolean; tag: EventTag }>>`
      select to_char(start_time, 'HH24:MI') as start_time, to_char(arrive_time, 'HH24:MI') as arrive_time,
             arrive_manual, concert, source_title, concert_details_imported, tag::text as tag
      from event where id = ${c.eventId} for update`;
    if (!cur) continue;
    const arrive = resolveArrive(
      { startTime: cur.start_time, arriveTime: cur.arrive_time, manual: cur.arrive_manual },
      { startTime: c.after.startTime, arriveTime: cur.arrive_time, tag: cur.tag },
    );
    const concert = !cur.concert_details_imported && (cur.concert === null || cur.concert === cur.source_title)
      ? (c.after.title || null) : cur.concert;
    try {
      await tx.savepoint((sp) => sp`
        update event set start_time = ${c.after.startTime}, arrive_time = ${arrive.arriveTime},
          arrive_manual = ${arrive.manual}, concert = ${concert}, source_title = ${c.after.title}
        where id = ${c.eventId}`);
    } catch (error) {
      if (error instanceof postgres.PostgresError && error.code === '23505') {
        throw new UserError(`${formatDate(c.after.date)} в ${c.after.startTime} уже есть другое мероприятие`);
      }
      throw error;
    }
    changed += 1;
  }

  const remove = diff.missing.filter((m) => selection.remove.includes(m.eventId)).map((m) => m.eventId);
  const removed = remove.length === 0 ? [] : await tx<{ id: string }[]>`
    delete from event where id in ${tx(remove)} and source_title is not null returning id`;
  return { added, changed, removed: removed.length };
}
