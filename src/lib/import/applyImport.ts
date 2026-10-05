import type { Tx } from '@/db/client';
import type { ParsedEvent, ParsedStaff } from './parseSheet';
import { cleanName, nameKey } from './normalizeName';
import { checkQuantity } from '@/lib/quantity';
import { UserError } from '@/lib/errors';
import { copyEventTypeSlots, resolveEventType, refreshEventTypeRate } from '@/lib/eventTypes/operations';

export type ImportConflict = {
  date: string;
  startTime: string;
  name: string;
  kept: string;
  dropped: string;
};

export type ImportSummary = {
  eventsCreated: number;
  eventsUpdated: number;
  workersCreated: number;
  assignmentsCreated: number;
  conflicts: ImportConflict[];
};

/** Слоты нового события — копия шаблона должностей. */
export async function createSlotsFromTemplate(tx: Tx, eventId: string): Promise<void> {
  const [event] = await tx<{ event_type_id: string }[]>`select event_type_id from event where id=${eventId}`;
  if (!event) throw new UserError('Событие не найдено');
  await copyEventTypeSlots(tx,eventId,event.event_type_id);
}

export type MergeConflict = { name: string; kept: string; dropped: string };
export type MergeResult = { staff: ParsedStaff[]; conflicts: MergeConflict[] };

/**
 * Один человек дважды в одной колонке: одна запись. «Не расставлен» (null)
 * поверх должности — не конфликт, должность остаётся. Две разные должности
 * — остаётся более поздняя (порядок как в исходном списке строк листа),
 * конфликт уходит в отчёт, ничего не теряется молча.
 */
export function mergeStaff(staff: ParsedStaff[]): MergeResult {
  const byKey = new Map<string, ParsedStaff>();
  const conflicts: MergeConflict[] = [];
  for (const person of staff) {
    const key = nameKey(person.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...person });
    } else if (person.position === null) {
      // null поверх должности — не конфликт, ничего не меняем
    } else if (existing.position === null) {
      existing.position = person.position;
    } else if (existing.position !== person.position) {
      conflicts.push({ name: existing.name, kept: person.position, dropped: existing.position });
      existing.position = person.position;
    }
    // existing.position === person.position — та же должность дважды, не конфликт
  }
  return { staff: [...byKey.values()], conflicts };
}

/**
 * Пишет разобранные события. Вызывать внутри одной транзакции (withManager):
 * половина месяца в базе хуже, чем ничего. Лимиты слотов не проверяются —
 * импорт переносит историю как есть.
 */
export async function applyImport(
  tx: Tx, events: ParsedEvent[], options: { preserveExisting?: boolean; replacePositions?: boolean } = {},
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    eventsCreated: 0, eventsUpdated: 0, workersCreated: 0, assignmentsCreated: 0, conflicts: [],
  };

  const positions = await tx<{ id: string; name: string }[]>`select id, name from position`;
  const positionIds = new Map(positions.map((p) => [p.name, p.id]));
  const positionNames = new Map(positions.map((p) => [p.id, p.name]));
  const workerIds = new Map<string, string>();
  // Защищаем пары, существовавшие до импорта. Новая пара из первого листа
  // может получить должность из второго листа той же загрузки.
  const priorAssignments = options.preserveExisting
    ? await tx<{worker_id:string;event_id:string}[]>`select worker_id,event_id from assignment` : [];
  const protectedPairs = new Set(priorAssignments.map(row => `${row.worker_id}|${row.event_id}`));

  async function workerId(raw: string): Promise<string> {
    const key = nameKey(raw);
    const cached = workerIds.get(key);
    if (cached) return cached;

    const existing = await tx<{ id: string }[]>`select id from worker where name_key = ${key}`;
    let id = existing[0]?.id;
    if (!id) {
      const [created] = await tx<{ id: string }[]>`
        insert into worker (full_name, name_key) values (${cleanName(raw)}, ${key}) returning id`;
      id = created.id;
      summary.workersCreated += 1;
    }
    workerIds.set(key, id);
    return id;
  }

  // Все виды до любых мероприятий: массовое сохранение ставок блокирует
  // вид → мероприятия → места. Смешанный импорт не должен замыкать этот порядок.
  const prepared = [];
  for (const event of [...events].sort((a,b)=>a.date.localeCompare(b.date)||a.startTime.localeCompare(b.startTime))) {
    const [existing] = await tx<{event_type_id:string}[]>`select event_type_id from event
      where event_date=${event.date} and start_time=${event.startTime}`;
    const type = await resolveEventType(tx,options.preserveExisting && existing
      ? {id:existing.event_type_id,currentTypeId:existing.event_type_id}
      : event.eventTypeName !== undefined
      ? {name:event.eventTypeName,currentTypeId:existing?.event_type_id}
      : existing ? {id:existing.event_type_id,currentTypeId:existing.event_type_id} : {systemTag:event.tag});
    prepared.push({event,type});
  }
  for (const {event,type} of prepared) {
    const [existing] = await tx<{event_type_id:string}[]>`select event_type_id from event
      where event_date=${event.date} and start_time=${event.startTime} for update`;
    if (existing && (((options.preserveExisting || event.eventTypeName===undefined) && existing.event_type_id!==type.id)
      || (type.archived && existing.event_type_id!==type.id))) {
      throw new UserError('Вид мероприятия изменился — обновите сверку и повторите импорт');
    }
    const [row] = await tx<{ id: string; inserted: boolean; event_type_id: string }[]>`
      insert into event (event_date, start_time, arrive_time, arrive_manual, concert, tag, event_type_id, base_rate, comment)
      values (${event.date}, ${event.startTime}, ${event.arriveTime}, ${event.arriveTime !== null},
              ${event.concert}, ${type.systemTag ?? 'regular'}, ${type.id}, ${event.baseRate}, ${event.comment})
      on conflict (event_date, start_time) do update set
        arrive_time   = case when ${!!options.preserveExisting} then event.arrive_time else coalesce(excluded.arrive_time, event.arrive_time) end,
        arrive_manual = case when ${!!options.preserveExisting} then event.arrive_manual else excluded.arrive_time is not null or event.arrive_manual end,
        concert       = case when ${!!options.preserveExisting} or event.concert_details_imported then event.concert else coalesce(excluded.concert, event.concert) end,
        base_rate     = case when ${!!options.preserveExisting} then event.base_rate else coalesce(excluded.base_rate, event.base_rate) end,
        comment       = case when ${!!options.preserveExisting} then event.comment else coalesce(excluded.comment, event.comment) end,
        event_type_id = case when ${!options.preserveExisting && event.eventTypeName !== undefined} then excluded.event_type_id else event.event_type_id end
      returning id, (xmax = 0) as inserted, event_type_id`;

    if (row.event_type_id!==type.id) throw new UserError('Вид мероприятия изменился — обновите сверку и повторите импорт');

    if (row.inserted) {
      summary.eventsCreated += 1;
      await createSlotsFromTemplate(tx, row.id);
    } else {
      summary.eventsUpdated += 1;
      if (!options.preserveExisting) await refreshEventTypeRate(tx,row.id,type.id);
    }

    const merged = mergeStaff(event.staff);
    if (row.inserted) {
      const counts = new Map<string,number>();
      for (const person of merged.staff) {
        if (person.position !== null) counts.set(person.position,(counts.get(person.position) ?? 0)+1);
      }
      for (const [name,count] of counts) {
        checkQuantity(count);
        const positionId = positionIds.get(name);
        if (!positionId) throw new UserError(`В справочнике нет должности «${name}»`);
        await tx`insert into event_slot(event_id,position_id,quantity) values (${row.id},${positionId},${count})
          on conflict (event_id,position_id) do update set quantity=greatest(event_slot.quantity,excluded.quantity)`;
      }
    }
    for (const conflict of merged.conflicts) {
      summary.conflicts.push({ date: event.date, startTime: event.startTime, ...conflict });
    }

    for (const person of merged.staff) {
      const positionId = person.position ? positionIds.get(person.position) : null;
      if (person.position && !positionId) {
        throw new UserError(`В справочнике нет должности «${person.position}»`);
      }
      const id = await workerId(person.name);
      // prev — должность до этой записи (для новой пары worker/event её нет:
      // строка ещё не существует, подзапрос вернёт 0 строк — prev_position_id
      // будет null, ложного конфликта на вставке не будет).
      const [result] = await tx<{
        inserted: boolean; position_id: string | null; prev_position_id: string | null;
      }[]>`
        with prev as (
          select position_id from assignment where worker_id = ${id} and event_id = ${row.id}
        )
        insert into assignment (worker_id, event_id, position_id)
        values (${id}, ${row.id}, ${positionId ?? null})
        on conflict (worker_id, event_id) do update
          set position_id = case when ${!!options.preserveExisting && !options.replacePositions && protectedPairs.has(`${id}|${row.id}`)} then assignment.position_id
            else coalesce(excluded.position_id, assignment.position_id) end
        returning (xmax = 0) as inserted, position_id,
          (select position_id from prev) as prev_position_id`;
      if (result.inserted) summary.assignmentsCreated += 1;

      if (
        result.prev_position_id !== null
        && result.position_id !== null
        && result.prev_position_id !== result.position_id
      ) {
        summary.conflicts.push({
          date: event.date,
          startTime: event.startTime,
          name: cleanName(person.name),
          kept: positionNames.get(result.position_id) ?? result.position_id,
          dropped: positionNames.get(result.prev_position_id) ?? result.prev_position_id,
        });
      }
    }
  }

  return summary;
}
