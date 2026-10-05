import type { SheetCell, SheetRows } from '@/lib/import/parseSheet';
import type { WorkbookSheet } from '@/lib/import/workbook';
import { parseTimes } from '@/lib/schedule/parseSchedule';
import { isMonth } from '@/lib/month';
import { UserError } from '@/lib/errors';

export type ConcertRow = {
  key: string; sheetName: string; row: number; date: string; startTime: string;
  title: string | null; program: string | null; performers: string | null; issue: string | null;
};

const text = (cell: SheetCell | undefined): string | null =>
  typeof cell === 'string' && cell.trim() ? cell.replace(/\r\n?/g, '\n').trim() : null;

function dateOf(cell: SheetCell | undefined, year: number | null): string | null {
  if (cell instanceof Date) return Number.isFinite(cell.getTime()) ? cell.toISOString().slice(0, 10) : null;
  if (typeof cell === 'number' && cell > 0 && cell < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(cell) * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof cell !== 'string') return null;
  const raw = cell.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const ru = raw.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/);
  const y = iso ? Number(iso[1]) : ru?.[3] ? Number(ru[3]) : year;
  const m = iso ? Number(iso[2]) : ru ? Number(ru[2]) : 0;
  const d = iso ? Number(iso[3]) : ru ? Number(ru[1]) : 0;
  if (!y || y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? date.toISOString().slice(0, 10) : null;
}

function header(rows: SheetRows): { index: number; columns: Map<string, number> } | null {
  for (let index = 0; index < Math.min(5, rows.length); index++) {
    const columns = new Map<string, number>();
    rows[index].forEach((cell, col) => {
      const name = text(cell)?.toLowerCase();
      if (name && !columns.has(name)) columns.set(name, col);
    });
    if (['дата', 'название', 'время'].every(name => columns.has(name))) return { index, columns };
  }
  return null;
}

/** Только значения: никакой базы, ExcelJS или угадывания концерта по названию. */
export function parseConcerts(sheets: WorkbookSheet[], month: string): ConcertRow[] {
  if (!isMonth(month)) throw new UserError('Неверный месяц');
  const parsed: ConcertRow[] = [];
  for (const sheet of sheets) {
    const found = header(sheet.rows);
    if (!found) continue;
    const yearText = sheet.name.match(/(?:^|\D)(20\d{2})(?:\D|$)/)?.[1];
    const year = yearText ? Number(yearText) : null;
    const cell = (row: SheetCell[], name: string) => {
      const col = found.columns.get(name);
      return col === undefined ? null : row[col] ?? null;
    };
    for (let i = found.index + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const rawDate = cell(row, 'дата');
      const title = text(cell(row, 'название'));
      const program = text(cell(row, 'описание'));
      const performers = text(cell(row, 'артисты')) ?? text(cell(row, 'исполнители'));
      const rawTime = cell(row, 'время');
      if (rawDate === null && !title && !program && !performers && rawTime === null) continue;
      const date = dateOf(rawDate, year);
      if (date && !date.startsWith(`${month}-`)) continue;
      if (!date && year !== null && year !== Number(month.slice(0, 4))) continue;
      const times = parseTimes(rawTime);
      parsed.push({
        key: `${sheet.name}:${i + 1}`, sheetName: sheet.name, row: i + 1, date: date ?? '',
        startTime: times.length === 1 ? times[0] : '', title, program, performers,
        issue: !date ? 'Не удалось разобрать дату.' : times.length !== 1 ? 'Нужно одно точное время начала.' : null,
      });
    }
  }
  const counts = new Map<string, number>();
  for (const row of parsed.filter(r => !r.issue)) {
    const key = `${row.date}|${row.startTime}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return parsed.map(row => !row.issue && (counts.get(`${row.date}|${row.startTime}`) ?? 0) > 1
    ? { ...row, issue: 'Повтор даты и времени в таблице — проверьте строки.' } : row);
}
