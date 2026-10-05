/**
 * Сводка месяца менеджера — чистые функции над уже загруженными данными
 * (`monthEvents`, `understaffedItems`, `payForMonth`): без запросов к базе.
 */

type Staffing = { needed: number; filled: number };

/**
 * Заполненность мест: занятые места из нужных. Люди сверх мест мероприятия
 * (в том числе без должности) не закрывают нехватку другого — у каждого мероприятия
 * в счёт идёт не больше его мест. Процент — вниз: 100 % только когда занято всё.
 */
export function fillRate(events: Staffing[]): { filled: number; needed: number; percent: number | null } {
  let filled = 0;
  let needed = 0;
  for (const e of events) {
    needed += e.needed;
    filled += Math.min(e.filled, e.needed);
  }
  return { filled, needed, percent: needed > 0 ? Math.floor((filled * 100) / needed) : null };
}

type Pending = { id: string; date: string; startTime: string; concert: string | null; pendingSignups: number; cancelRequests: number };

/** «Ждут решения»: заявки и запросы отмены за месяц и мероприятия с ними (по дате и времени, не больше `limit`). */
export function pendingSummary<T extends Pending>(events: T[], limit: number): {
  signups: number; cancels: number; events: T[]; more: number;
} {
  const waiting = events
    .filter((e) => e.pendingSignups > 0 || e.cancelRequests > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  return {
    signups: events.reduce((s, e) => s + e.pendingSignups, 0),
    cancels: events.reduce((s, e) => s + e.cancelRequests, 0),
    events: waiting.slice(0, limit),
    more: Math.max(0, waiting.length - limit),
  };
}

/** «Не хватает людей»: всего свободных мест и мероприятий; список — первые `limit` (порядок — как пришёл, по дате). */
export function shortageSummary<T extends { free: number }>(items: T[], limit: number): {
  missing: number; events: number; shown: T[]; more: number;
} {
  return {
    missing: items.reduce((s, i) => s + i.free, 0),
    events: items.length,
    shown: items.slice(0, limit),
    more: Math.max(0, items.length - limit),
  };
}

/** Итог месяца к прошлому: разница в рублях и в процентах (целых); прошлый месяц без выплат — без процента. */
export function payComparison(current: number, previous: number): { delta: number; percent: number | null } {
  return {
    delta: current - previous,
    percent: previous > 0 ? Math.round(((current - previous) * 100) / previous) : null,
  };
}
