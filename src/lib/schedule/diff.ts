import type { ScheduleEvent } from './parseSchedule';
import { normalize } from './rules';

export type ExistingEvent = { id: string; date: string; startTime: string; sourceTitle: string | null; people: number };
export type ScheduleChange = { eventId: string; before: { startTime: string; title: string }; after: ScheduleEvent };
export type MissingEvent = { eventId: string; date: string; startTime: string; title: string; people: number };
export type ScheduleDiff = { added: ScheduleEvent[]; changed: ScheduleChange[]; missing: MissingEvent[]; unchanged: number };

const sameTitle = (a: string, b: string) => normalize(a) === normalize(b);

/**
 * Разница листа с мероприятиями месяца в базе. Мероприятие узнаётся по дате
 * и началу, иначе — по дате и исходному названию. Созданные вручную
 * (sourceTitle = null) не меняются и не пропадают. Проблемные строки не участвуют.
 */
export function diffSchedule(existing: ExistingEvent[], incoming: ScheduleEvent[]): ScheduleDiff {
  const diff: ScheduleDiff = { added: [], changed: [], missing: [], unchanged: 0 };
  const used = new Set<string>();
  const byTime = new Map(existing.map((e) => [`${e.date}|${e.startTime}`, e]));
  const change = (match: ExistingEvent, after: ScheduleEvent) => diff.changed.push({
    eventId: match.id, before: { startTime: match.startTime, title: match.sourceTitle ?? '' }, after,
  });

  const unmatched: ScheduleEvent[] = [];
  for (const e of incoming.filter((x) => x.issue === null)) {
    const match = byTime.get(`${e.date}|${e.startTime}`);
    if (!match || used.has(match.id)) { unmatched.push(e); continue; }
    used.add(match.id);
    if (match.sourceTitle === null || sameTitle(match.sourceTitle, e.title)) diff.unchanged += 1;
    else change(match, e);
  }
  for (const e of unmatched) {
    const match = existing.find((x) => !used.has(x.id) && x.sourceTitle !== null
      && x.date === e.date && sameTitle(x.sourceTitle, e.title));
    if (!match) { diff.added.push(e); continue; }
    used.add(match.id);
    change(match, e);
  }
  for (const x of existing) {
    if (!used.has(x.id) && x.sourceTitle !== null) {
      diff.missing.push({ eventId: x.id, date: x.date, startTime: x.startTime, title: x.sourceTitle, people: x.people });
    }
  }
  return diff;
}
