import { createHash } from 'node:crypto';
import type { Tx } from '@/db/client';
import { UserError } from '@/lib/errors';
import type { ParsedEvent } from './parseSheet';
import { applyImport, mergeStaff } from './applyImport';
import { nameKey } from './normalizeName';
import { eventsForSelection, type SheetSelection } from './prepare';
import type { WorkbookSheet } from './workbook';

export type PositionConflict = { date: string; startTime: string; name: string; current: string | null; incoming: string };
export type PotentialMove = { date: string; startTime: string; title: string; candidates: { date: string; startTime: string }[] };

export async function importPotentialMoves(tx: Tx, events: ParsedEvent[]): Promise<PotentialMove[]> {
  const existing = await tx<{ date: string; startTime: string; concert: string | null; source_title: string | null }[]>`
    select to_char(event_date,'YYYY-MM-DD') as date, to_char(start_time,'HH24:MI') as "startTime",concert,source_title from event`;
  const exact = new Set(existing.map(row => `${row.date}|${row.startTime}`));
  const result: PotentialMove[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const key = `${event.date}|${event.startTime}`;
    if (exact.has(key) || seen.has(key) || !event.concert?.trim()) continue;
    seen.add(key);
    const title = event.concert.trim().toLowerCase();
    const matches = existing.filter(row => [row.concert,row.source_title].some(text => text?.trim().toLowerCase() === title));
    const sameDay = matches.filter(row => row.date === event.date);
    const candidates = sameDay.length > 0 ? sameDay : matches.length === 1 ? matches : [];
    if (candidates.length > 0) result.push({ date:event.date,startTime:event.startTime,title:event.concert,
      candidates:candidates.map(({date,startTime})=>({date,startTime})) });
  }
  return result;
}

/** Год и выбор листов уже заданы: только эти строки участвуют в сверке. */
export async function previewGoogleStaffReview(tx: Tx, sheets: WorkbookSheet[], selection: SheetSelection[]) {
  const events = eventsForSelection(sheets, selection);
  const eventCounts = Object.fromEntries(selection.map(sheet => [sheet.name,eventsForSelection(sheets,[sheet]).length]));
  return { snapshot:await importDbSnapshot(tx), positionConflicts:await importPositionConflicts(tx,events),
    moves:await importPotentialMoves(tx,events), eventCounts };
}

export async function importPositionConflicts(tx: Tx, events: ParsedEvent[]): Promise<PositionConflict[]> {
  const existing = await tx<{ date: string; startTime: string; name_key: string; position: string | null }[]>`
    select to_char(e.event_date,'YYYY-MM-DD') as date, to_char(e.start_time,'HH24:MI') as "startTime",
      w.name_key, p.name as position from assignment a join event e on e.id=a.event_id
      join worker w on w.id=a.worker_id left join position p on p.id=a.position_id`;
  const positions = new Map(existing.map(row => [`${row.date}|${row.startTime}|${row.name_key}`, row.position]));
  const conflicts: PositionConflict[] = [];
  for (const event of events) for (const person of mergeStaff(event.staff).staff) {
    const key = `${event.date}|${event.startTime}|${nameKey(person.name)}`;
    if (person.position !== null && positions.has(key) && positions.get(key) !== person.position) {
      conflicts.push({ date: event.date, startTime: event.startTime, name: person.name,
        current: positions.get(key) ?? null, incoming: person.position });
    }
  }
  return conflicts;
}

/** Консервативная сверка: любое изменение мероприятий или назначений требует нового просмотра. */
export async function importDbSnapshot(tx: Tx, lock = false): Promise<string> {
  // Порядок совпадает с сохранением ставок вида и применением шаблонов.
  if (lock) {
    await tx`select id from event_type order by id for share`;
    await tx`select id from event order by event_date, start_time, id for update`;
    await tx`select event_id from event_slot order by event_id, position_id for update`;
    await tx`select id from assignment order by event_id, id for update`;
    await tx`select id from worker order by id for share`;
  }
  const types = await tx<{ payload: string }[]>`select to_jsonb(t)::text as payload from event_type t order by id`;
  const templates = await tx<{ payload: string }[]>`select to_jsonb(t)::text as payload from event_type_slot t order by event_type_id, position_id`;
  const positions = await tx<{ payload: string }[]>`select to_jsonb(p)::text as payload from position p order by id`;
  const events = await tx<{ payload: string }[]>`select to_jsonb(e)::text as payload from event e order by event_date, start_time, id`;
  const slots = await tx<{ payload: string }[]>`select to_jsonb(s)::text as payload from event_slot s order by event_id, position_id`;
  const assignments = await tx<{ payload: string }[]>`select to_jsonb(a)::text as payload from assignment a order by event_id, id`;
  const workers = await tx<{ id: string; full_name: string; name_key: string }[]>`select id, full_name, name_key from worker order by id`;
  return createHash('sha256').update(JSON.stringify({ types, templates, positions, events, slots, assignments, workers })).digest('hex');
}

export function requireImportSnapshot(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new UserError('Обновите сверку перед импортом');
  }
  return value;
}

export async function checkImportSnapshot(tx: Tx, snapshot: string): Promise<void> {
  if (await importDbSnapshot(tx, true) !== snapshot) {
    throw new UserError('Данные приложения изменились — обновите сверку перед импортом');
  }
}

export async function applyGoogleImport(tx: Tx, events: ParsedEvent[], snapshot: string, replacePositions: boolean, allowPotentialMoves = false) {
  await checkImportSnapshot(tx, snapshot);
  if (!allowPotentialMoves && (await importPotentialMoves(tx, events)).length > 0) {
    throw new UserError('Возможный перенос мероприятия — проверьте сверку и отдельно подтвердите создание новых мероприятий');
  }
  return applyImport(tx, events, { preserveExisting: true, replacePositions });
}
