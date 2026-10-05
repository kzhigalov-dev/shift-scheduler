import { parseMonthSheet } from '@/lib/import/parseSheet';
import { previewSheets } from '@/lib/import/prepare';
import type { WorkbookSheet } from '@/lib/import/workbook';
import type { Tx } from '@/db/client';
import type { ParsedEvent } from '@/lib/import/parseSheet';
import type { NewScheduleEvent } from '@/lib/monthPlan/months';
import { UserError } from '@/lib/errors';
import { resolveEventType } from './operations';
export type EventTypeIssue = { date: string; startTime: string; message: string };
export async function scheduleTypeIssues(tx: Tx, incoming: NewScheduleEvent[]): Promise<EventTypeIssue[]> {
  const issues: EventTypeIssue[] = [];
  for (const e of incoming) {
    try { await resolveEventType(tx,{systemTag:e.tag}); }
    catch (error) {
      if (!(error instanceof UserError)) throw error;
      issues.push({date:e.date,startTime:e.startTime,message:error.message});
    }
  }
  return issues;
}
export async function workerImportTypeIssues(tx: Tx, incoming: ParsedEvent[]): Promise<EventTypeIssue[]> {
  const issues: EventTypeIssue[] = [];
  for (const e of incoming) {
    const [existing] = await tx<{event_type_id:string}[]>`select event_type_id from event
      where event_date=${e.date} and start_time=${e.startTime}`;
    try {
      await resolveEventType(tx,e.eventTypeName !== undefined
        ? {name:e.eventTypeName,currentTypeId:existing?.event_type_id}
        : existing ? {id:existing.event_type_id,currentTypeId:existing.event_type_id} : {systemTag:e.tag});
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      issues.push({date:e.date,startTime:e.startTime,message:error.message});
    }
  }
  return issues;
}

/** Проверяет явные названия до подтверждения импорта; лист без года проверится при применении. */
export async function previewImportTypes(tx: Tx, sheets: WorkbookSheet[]) {
  const previews = previewSheets(sheets);
  for (const preview of previews) {
    const sheet = sheets.find(s => s.name === preview.sheetName);
    if (!sheet || preview.needsYear) continue;
    const issues = await workerImportTypeIssues(tx, parseMonthSheet(sheet.rows, sheet.name).events);
    preview.issues.push(...issues.map(i => ({ column: null, message: `${i.date} ${i.startTime}: ${i.message}` })));
  }
  return previews;
}
