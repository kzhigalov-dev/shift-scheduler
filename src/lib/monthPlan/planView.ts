import { formatMoney } from '@/lib/format';
import type { MonthPlan, PlanColumn, PlanPerson } from './plan';

/** Ещё не подтверждённая правка ячейки; token — номер запроса, который её поставил. */
export type Override = { person: PlanPerson | null; token: number };
export type Overrides = ReadonlyMap<string, Override>;
export type PlanField = 'startTime' | 'arriveTime' | 'baseRate';

/** Поля мероприятия и их подписи — в таблице и в карточке, в этом порядке. */
export const PLAN_FIELDS: Array<[PlanField, string]> = [['startTime', 'Начало'], ['arriveTime', 'Приход'], ['baseRate', 'Ставка']];
/** Подсказка у прихода, который не задан вручную. */
export const AUTO_ARRIVE_TITLE = 'Автоматически по типу мероприятия';

export const cellKey = (eventId: string, positionId: string, row: number) => `${eventId}:${positionId}:${row}`;
export const fieldKey = (eventId: string, field: PlanField) => `field:${eventId}:${field}`;

/** Значение поля мероприятия для правки: пустое (нет прихода, ставка уточняется) — пустая строка. */
export function planFieldValue(c: PlanColumn, f: PlanField): string {
  if (f === 'startTime') return c.startTime;
  if (f === 'arriveTime') return c.arriveTime ?? '';
  return c.baseRate === null ? '' : String(c.baseRate);
}

/** Значение поля мероприятия для показа: ставка — деньгами, пустое — «—». */
export function planFieldDisplay(c: PlanColumn, f: PlanField): string {
  if (f === 'baseRate') return c.baseRate === null ? '—' : formatMoney(c.baseRate);
  return planFieldValue(c, f) || '—';
}

/** Человек в ячейке с учётом неподтверждённых правок. */
export function effectivePerson(
  plan: MonthPlan, overrides: Overrides, eventId: string, positionId: string, row: number,
): PlanPerson | null {
  const override = overrides.get(cellKey(eventId, positionId, row));
  return override ? override.person : plan.people[eventId]?.[positionId]?.[row] ?? null;
}

/** Смены в месяце: ячейки таблицы + люди без должности; имена — из работников и ячеек. */
export function shiftTotals(plan: MonthPlan, overrides: Overrides) {
  const counts = new Map<string, number>();
  const names = new Map(plan.workers.map((w) => [w.workerId, w.fullName]));
  const add = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const c of plan.columns) {
    for (const id of plan.unplaced[c.eventId] ?? []) add(id);
    for (const p of plan.positions) {
      for (let row = 0; row < p.rows; row++) {
        const person = effectivePerson(plan, overrides, c.eventId, p.id, row);
        if (!person) continue;
        add(person.workerId);
        if (!names.has(person.workerId)) names.set(person.workerId, person.fullName);
      }
    }
  }
  return { counts, names };
}

export function sortedCounts(
  counts: ReadonlyMap<string, number>, names: ReadonlyMap<string, string>,
): Array<[string, number]> {
  return [...counts].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]
    || (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? '', 'ru'));
}

/** Кто уже стоит на мероприятии: id → должность («без должности»). */
export function busyOn(plan: MonthPlan, overrides: Overrides, eventId: string): Map<string, string> {
  const busy = new Map<string, string>();
  for (const id of plan.unplaced[eventId] ?? []) busy.set(id, 'без должности');
  for (const p of plan.positions) {
    for (let row = 0; row < p.rows; row++) {
      const person = effectivePerson(plan, overrides, eventId, p.id, row);
      if (person) busy.set(person.workerId, p.name);
    }
  }
  return busy;
}

export type Place = { positionId: string; positionName: string; row: number; label: string; person: PlanPerson | null };

/** Места мероприятия для карточки: только активные (в пределах количества или занятые). */
export function eventPlaces(plan: MonthPlan, overrides: Overrides, eventId: string): Place[] {
  const places: Place[] = [];
  for (const p of plan.positions) {
    const quantity = plan.quantity[eventId]?.[p.id] ?? 0;
    const active = Array.from({ length: p.rows }, (_, row) => row)
      .map((row) => ({ row, person: effectivePerson(plan, overrides, eventId, p.id, row) }))
      .filter(({ row, person }) => row < quantity || person !== null);
    for (const { row, person } of active) {
      places.push({
        positionId: p.id, positionName: p.name, row, person,
        label: active.length > 1 ? `${p.name} ${row + 1}` : p.name,
      });
    }
  }
  return places;
}

/** Все места заняты (и места вообще есть). */
export function isEventFull(plan: MonthPlan, overrides: Overrides, eventId: string): boolean {
  const places = eventPlaces(plan, overrides, eventId);
  return places.length > 0 && places.every((p) => p.person !== null);
}

/** Какое мероприятие открыть в карточках: запрошенное, иначе первое с сегодняшнего дня, иначе первое. */
export function pickEventId(columns: PlanColumn[], today: string, requested: string | null): string | null {
  if (requested && columns.some((c) => c.eventId === requested)) return requested;
  return (columns.find((c) => c.date >= today) ?? columns[0])?.eventId ?? null;
}
