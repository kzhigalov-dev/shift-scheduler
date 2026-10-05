import type { EventTag, SheetCell, SheetRows } from '@/lib/import/parseSheet';
import type { WorkbookSheet } from '@/lib/import/workbook';
import {
  ANNENKIRCHE, SHIFT_DIRECTIONS, autoArriveTime, classifyTag, isArtZerno, normalize,
} from './rules';

export type ScheduleEvent = {
  /** Ключ выбора: `YYYY-MM-DD|HH:MM`; у проблемной строки — `row:<строка>:<номер>`. */
  key: string;
  /** Номер строки листа (с 1) — для сообщений. */
  row: number;
  date: string;
  /** '' — время не распознано (строка проблемная). */
  startTime: string;
  /** Исходное название из листа — оно же `event.source_title`. */
  title: string;
  tag: EventTag;
  /** Автоматический приход; '' — нет времени начала. */
  arriveTime: string;
  comment: string | null;
  organizer: string;
  direction: string;
  /** Галочка по умолчанию. */
  checked: boolean;
  /** Причина, по которой строку нельзя взять; null — строка в порядке. */
  issue: string | null;
};

export type ScheduleSheet = { name: string; month: string; events: ScheduleEvent[] };

const REQUIRED = ['дата', 'направление', 'площадка', 'организатор', 'название', 'начало'] as const;
const EXTRA = [
  ['запуск', 'Запуск'], ['идет', 'Идёт'], ['исполнители', 'Исполнители'], ['комментарий', 'Комментарий'],
] as const;
type Columns = Record<(typeof REQUIRED)[number], number>
  & Partial<Record<(typeof EXTRA)[number][0], number>>;

/** Заголовок ищется в первых строках листа (в файле он во второй). */
const HEADER_SCAN_ROWS = 5;
const TIME_IN_TEXT = /(?<!\d)([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/g;
const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

function hhmm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Время из ячейки-даты 1899-12-30: exceljs иногда даёт 20:29:59.999 вместо 20:30. */
function timeOfDate(d: Date): string {
  const seconds = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()
    + d.getUTCMilliseconds() / 1000;
  return hhmm(Math.round(seconds / 60) % 1440);
}

/** Время из ячейки: время-дата, доля суток или текст с одним или несколькими HH:MM. */
export function parseTimes(cell: SheetCell | undefined): string[] {
  if (cell === null || cell === undefined) return [];
  if (cell instanceof Date) return [timeOfDate(cell)];
  if (typeof cell === 'number') {
    return cell >= 0 && cell < 1 ? [hhmm(Math.round(cell * 1440) % 1440)] : [];
  }
  return [...cell.matchAll(TIME_IN_TEXT)].map((m) => `${pad(Number(m[1]))}:${m[2]}`);
}

/** Текст ячейки: строки без пробелов по краям, пустые строки убраны. */
function text(cell: SheetCell | undefined): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return timeOfDate(cell);
  return String(cell).split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

/** Дата из ячейки-даты (округление до суток — на случай сдвига часового пояса). */
function dateOf(cell: SheetCell | undefined): string | null {
  if (!(cell instanceof Date)) return null;
  return new Date(Math.round(cell.getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

function findHeader(rows: SheetRows): { index: number; columns: Columns } | null {
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rows.length); i++) {
    const found = new Map<string, number>();
    (rows[i] ?? []).forEach((cell, col) => {
      const name = normalize(text(cell));
      if (name && !found.has(name)) found.set(name, col);
    });
    if (REQUIRED.every((h) => found.has(h))) {
      const names = [...REQUIRED, ...EXTRA.map(([h]) => h)].filter((h) => found.has(h));
      return { index: i, columns: Object.fromEntries(names.map((h) => [h, found.get(h)])) as Columns };
    }
  }
  return null;
}

/** «Запуск: …», «Идёт: …» — по строке на непустую колонку. Два мероприятия в строке — каждому свой запуск. */
function commentFor(row: SheetCell[], columns: Columns, index: number, count: number): string | null {
  const lines: string[] = [];
  for (const [header, label] of EXTRA) {
    const col = columns[header];
    if (col === undefined) continue;
    const times = header === 'запуск' ? parseTimes(row[col]) : [];
    const value = count > 1 && times.length === count ? times[index] : text(row[col]).replace(/\n/g, '; ');
    if (value) lines.push(`${label}: ${value}`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/** Месяц большинства дат; при равенстве — более ранний. */
function majorityMonth(dates: string[]): string | null {
  const counts = new Map<string, number>();
  for (const date of dates) counts.set(date.slice(0, 7), (counts.get(date.slice(0, 7)) ?? 0) + 1);
  let best: string | null = null;
  for (const [month, n] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    if (best === null || n > (counts.get(best) ?? 0)) best = month;
  }
  return best;
}

/**
 * Лист расписания. null — лист другого формата или без единой даты.
 * Лист, где дни уже проставлены, а мероприятий Анненкирхе ещё нет, — `events: []`:
 * месяц считается по всем датам листа, включая пустые дни и другие площадки.
 */
export function parseScheduleSheet(name: string, rows: SheetRows): ScheduleSheet | null {
  const header = findHeader(rows);
  if (!header) return null;
  const c = header.columns;
  const events: ScheduleEvent[] = [];
  const dates: string[] = [];

  for (let r = header.index + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const rawDate = row[c.дата];
    if (text(rawDate) === '') continue; // пустые строки до конца листа
    const date = dateOf(rawDate);
    if (date) dates.push(date);
    const venue = normalize(text(row[c.площадка]));
    if (venue && venue !== ANNENKIRCHE) continue; // ПУШКИН и другие площадки
    // В листе у каждого дня заранее стоит дата: строка без площадки, названия и начала — не мероприятие.
    if (!venue && text(row[c.название]) === '' && text(row[c.начало]) === '') continue;

    const startText = text(row[c.начало]).replace(/\n/g, ' ');
    const times = parseTimes(row[c.начало]);
    let issue: string | null = null;
    if (!date) issue = `Не понятна дата: «${text(rawDate)}»`;
    else if (!venue) issue = 'Не указана площадка';
    else if (times.length === 0) issue = startText ? `Не понятно время начала: «${startText}»` : 'Нет времени начала';

    const organizer = text(row[c.организатор]).replace(/\n/g, ' ');
    const direction = text(row[c.направление]).replace(/\n/g, ' ');
    const lines = text(row[c.название]).split('\n');
    const starts = times.length > 0 ? times : [''];
    starts.forEach((startTime, i) => {
      const title = starts.length > 1 && lines.length === starts.length ? lines[i] : lines.join(' / ');
      const tag = classifyTag(direction, title, startTime || '00:00');
      events.push({
        key: '', row: r + 1, date: date ?? '', startTime, title, tag,
        arriveTime: startTime ? autoArriveTime(tag, startTime) : '',
        comment: commentFor(row, c, i, starts.length),
        organizer, direction, checked: false, issue,
      });
    });
  }

  const month = majorityMonth(dates);
  if (!month) return null;
  const seen = new Map<string, number>();
  events.forEach((e, i) => {
    if (!e.issue && !e.date.startsWith(`${month}-`)) e.issue = 'Дата не из месяца листа';
    const key = `${e.date}|${e.startTime}`;
    if (!e.issue) {
      const first = seen.get(key);
      if (first !== undefined) e.issue = `На это время уже есть мероприятие (строка ${first})`;
      else seen.set(key, e.row);
    }
    e.key = e.issue ? `row:${e.row}:${i}` : key;
    e.checked = !e.issue && isArtZerno(e.organizer)
      && (SHIFT_DIRECTIONS as readonly string[]).includes(normalize(e.direction));
  });
  return { name, month, events };
}

/** Листы книги в формате расписания, в порядке книги. */
export function scheduleSheets(sheets: WorkbookSheet[]): ScheduleSheet[] {
  return sheets.flatMap((s) => {
    const parsed = parseScheduleSheet(s.name, s.rows);
    return parsed ? [parsed] : [];
  });
}
