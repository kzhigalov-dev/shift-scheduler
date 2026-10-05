import type { Tx } from '@/db/client';
import type { ScheduleSheet } from '@/lib/schedule/parseSchedule';
import { diffSchedule } from '@/lib/schedule/diff';
import { scheduleTypeIssues } from '@/lib/eventTypes/importChecks';
import { monthInfo, existingForDiff } from './months';

/** Сначала сопоставляем старые события; архив запрещает только новые строки. */
export async function previewSchedule(tx: Tx, month: string, sheets: ScheduleSheet[]) {
  const isNew = (await monthInfo(tx, month)).events === 0;
  const existing = isNew ? [] : await existingForDiff(tx, month);
  const previews = [];
  for (const sheet of sheets) {
    const diff = diffSchedule(existing, sheet.events);
    const issues = await scheduleTypeIssues(tx, isNew ? sheet.events.filter(e => e.issue === null) : diff.added);
    const checked = (event: ScheduleSheet['events'][number]) => {
      const issue = issues.find(i => i.date === event.date && i.startTime === event.startTime)?.message;
      return issue ? { ...event, issue, checked: false } : event;
    };
    previews.push({ ...sheet, events: sheet.events.map(checked),
      ...(isNew ? {} : { diff: { ...diff, added: diff.added.map(checked) } }) });
  }
  return { mode: isNew ? 'create' as const : 'update' as const, sheets: previews };
}
