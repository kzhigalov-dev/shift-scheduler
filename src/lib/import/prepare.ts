import { parseMonthSheet, type ParsedEvent, type ParseIssue } from './parseSheet';
import type { WorkbookSheet } from './workbook';
import { UserError } from '@/lib/errors';
import { scheduleSheets } from '@/lib/schedule/parseSchedule';

export type SheetPreview = {
  sheetName: string;
  needsYear: boolean;
  issues: ParseIssue[];
  events: Array<{ date: string; startTime: string; concert: string | null; staffCount: number }>;
};

export type SheetSelection = { name: string; year?: number };

export function previewSheets(sheets: WorkbookSheet[]): SheetPreview[] {
  return sheets.flatMap((sheet) => {
    const result = parseMonthSheet(sheet.rows, sheet.name);
    if (result.events.length === 0 && result.issues.length === 0 && !result.needsYear) return [];
    return [{
      sheetName: sheet.name,
      needsYear: result.needsYear,
      issues: result.issues,
      events: result.events.map((e) => ({
        date: e.date, startTime: e.startTime, concert: e.concert, staffCount: e.staff.length,
      })),
    }];
  });
}

/**
 * Книга — расписание мероприятий (формат «Нового месяца»), а не таблица работников:
 * ни один лист не разобран как месяц с людьми, зато есть листы расписания.
 * Возвращает месяцы расписания по порядку; пусто — это не расписание.
 */
export function scheduleMonthsInstead(sheets: WorkbookSheet[]): string[] {
  if (previewSheets(sheets).some((s) => s.events.length > 0)) return [];
  return [...new Set(scheduleSheets(sheets).map((s) => s.month))].sort();
}

export const SCHEDULE_FILE_MESSAGE =
  'Это расписание мероприятий, а не таблица с работниками. Месяц из такого файла создаётся в «Новом месяце».';

/** Граница ввода: выбор листов приходит из браузера как JSON. */
export function parseSelection(raw: unknown): SheetSelection[] {
  if (!Array.isArray(raw)) throw new UserError('Не выбраны листы');
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) throw new UserError('Некорректный выбор листа');
    const { name, year } = item as { name?: unknown; year?: unknown };
    if (typeof name !== 'string' || !name) throw new UserError('Некорректное имя листа');
    if (year === undefined) return { name };
    if (typeof year !== 'number' || !Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new UserError(`Некорректный год у листа «${name}»`);
    }
    return { name, year };
  });
}

/** Выбор строк и отпечаток сверки программ концертов из браузера. */
export function parseConcertSelection(raw: unknown): { keys: string[]; snapshot: string } {
  if (!raw || typeof raw !== 'object') throw new UserError('Некорректный выбор концертов.');
  const { keys, snapshot } = raw as { keys?: unknown; snapshot?: unknown };
  if (!Array.isArray(keys) || keys.length > 5000 || keys.some(key => typeof key !== 'string' || key.length > 500)
    || typeof snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot)) {
    throw new UserError('Некорректный выбор концертов — обновите сверку.');
  }
  return { keys: keys as string[], snapshot };
}

export function eventsForSelection(
  sheets: WorkbookSheet[], selection: SheetSelection[],
): ParsedEvent[] {
  if (selection.length === 0) throw new UserError('Не выбран ни один лист');
  return selection.flatMap(({ name, year }) => {
    const sheet = sheets.find((s) => s.name === name);
    if (!sheet) throw new UserError(`В файле нет листа «${name}»`);
    const result = parseMonthSheet(sheet.rows, sheet.name, { year });
    if (result.needsYear) throw new UserError(`У листа «${name}» не выбран год`);
    return result.events;
  });
}

/**
 * Граница ввода: ошибка из withManager(applyImport(...)) может быть чем
 * угодно — наша проверка (UserError, текст можно показать пользователю),
 * ошибка Postgres (текст SQL наружу не отдаём, только логируем) или что-то
 * ещё неожиданное (то же самое, на всякий случай).
 */
export function importErrorResponse(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof UserError) {
    return { status: 400, body: { error: error.message } };
  }
  console.error('Ошибка базы при импорте:', error);
  return { status: 500, body: { error: 'Ошибка базы при импорте — ничего не записано' } };
}
