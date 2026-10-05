import { cleanName } from './normalizeName';

export type EventTag = 'regular' | 'chapel' | 'night' | 'seder' | 'organ' | 'excursion';

export const POSITION_NAMES = [
  'АДМИН', 'ЗАЛ', 'ВХОД В ЗАЛ', 'БИЛЕТЫ', 'БАЛКОН', 'ВХОД', 'КАССА',
] as const;
export type PositionName = (typeof POSITION_NAMES)[number];

export type ParsedStaff = { name: string; position: PositionName | null };

export type ParsedEvent = {
  date: string;
  startTime: string;
  arriveTime: string | null;
  concert: string | null;
  tag: EventTag;
  eventTypeName?: string;
  baseRate: number | null;
  rawRate: string | null;
  comment: string | null;
  staff: ParsedStaff[];
};

export type ParseIssue = { column: number | null; message: string };
export type ParseResult = { events: ParsedEvent[]; issues: ParseIssue[]; needsYear: boolean };
export type SheetCell = string | number | Date | null;
export type SheetRows = SheetCell[][];
export type ParseOptions = { year?: number };

const MONTHS: Record<string, number> = {
  январь: 1, февраль: 2, март: 3, апрель: 4, май: 5, июнь: 6,
  июль: 7, август: 8, сентябрь: 9, октябрь: 10, ноябрь: 11, декабрь: 12,
};

const TAGS: Record<string, EventTag> = {
  часовня: 'chapel', ночной: 'night', седер: 'seder', орган: 'organ', экскурсия: 'excursion',
};

/** Подпись строки -> должность. «Работник» — набран, но не расставлен. */
const STAFF_LABELS: Record<string, PositionName | null> = {
  админ: 'АДМИН', работник: null, зал: 'ЗАЛ', 'вход в зал': 'ВХОД В ЗАЛ',
  билеты: 'БИЛЕТЫ', балкон: 'БАЛКОН', вход: 'ВХОД', касса: 'КАССА',
};

/**
 * Строки-техтрек внутри блока людей — решение заказчика: не импортируются
 * в v1 (техтрек, возможно появятся в будущей задаче). Пропускаются молча,
 * без замечания «Неизвестная строка».
 */
const IGNORED_STAFF_LABELS = new Set(['проектор', 'помощник по звуку']);

function text(cell: SheetCell | undefined): string {
  if (cell === null || cell === undefined || cell instanceof Date) return '';
  return String(cell).trim();
}

function label(rows: SheetRows, index: number): string {
  return text(rows[index]?.[0]).toLowerCase().replace(/\s+/g, ' ').replace(/[:.]+$/, '');
}

function findRow(rows: SheetRows, from: number, test: (label: string) => boolean): number {
  for (let i = Math.max(from, 0); i < rows.length; i++) {
    if (test(label(rows, i))) return i;
  }
  return -1;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function sheetYear(sheetName: string): number | null {
  const match = sheetName.match(/(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function sheetMonth(sheetName: string): number | null {
  const word = sheetName.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return Object.hasOwn(MONTHS, word) ? MONTHS[word] : null;
}

function timeOf(cell: SheetCell | undefined): string | null {
  if (cell instanceof Date) return `${pad(cell.getUTCHours())}:${pad(cell.getUTCMinutes())}`;
  if (typeof cell === 'number' && cell >= 0 && cell < 1) {
    const minutes = Math.round(cell * 24 * 60);
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }
  const match = text(cell).match(/(\d{1,2})[:.](\d{2})/);
  return match ? `${pad(Number(match[1]))}:${match[2]}` : null;
}

/** День и возможные месяцы. У числа 1.1 месяц — 1 или 10: дробь теряет ноль. */
function dayAndMonths(cell: SheetCell): { day: number; months: number[] } | null {
  if (cell instanceof Date) return { day: cell.getUTCDate(), months: [cell.getUTCMonth() + 1] };
  if (typeof cell === 'number') {
    const [whole, fraction = ''] = String(cell).split('.');
    const digits = Number(fraction);
    const months = fraction.length === 1 ? [digits, digits * 10] : [digits];
    return { day: Number(whole), months: months.filter((m) => m >= 1 && m <= 12) };
  }
  const match = text(cell).match(/^(\d{1,2})\.(\d{1,2})/);
  return match ? { day: Number(match[1]), months: [Number(match[2])] } : null;
}

function resolveDate(
  day: number, months: number[], month: number | null, year: number,
): { date: string | null; warning: string | null } {
  let m = months[0];
  let y = year;
  let warning: string | null = null;

  if (month !== null) {
    if (months.includes(month)) m = month;
    else if (month === 12 && months.includes(1)) { m = 1; y = year + 1; }
    else if (month === 1 && months.includes(12)) { m = 12; y = year - 1; }
    else warning = 'месяц не совпадает с листом';
  }

  const probe = new Date(Date.UTC(y, m - 1, day));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== day) return { date: null, warning };
  return { date: `${y}-${pad(m)}-${pad(day)}`, warning };
}

function rateOf(cell: SheetCell | undefined): { rate: number | null; raw: string | null } {
  // Отрицательная ставка — не опечатка формата, а бессмысленное значение:
  // не угадываем, помечаем как неоднозначную (как «1500/2000»).
  if (typeof cell === 'number') {
    return cell < 0 ? { rate: null, raw: String(cell) } : { rate: Math.round(cell), raw: null };
  }
  const s = text(cell);
  if (!s) return { rate: null, raw: null };
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return { rate: null, raw: s };
  return n < 0 ? { rate: null, raw: s } : { rate: Math.round(n), raw: null };
}

export function parseMonthSheet(
  rows: SheetRows, sheetName: string, options: ParseOptions = {},
): ParseResult {
  const issues: ParseIssue[] = [];
  const month = sheetMonth(sheetName);

  const weekdayRow = findRow(rows, 0, (l) => l.startsWith('день недели'));
  if (weekdayRow < 1) {
    // Не лист месяца («Работники», «Монтаж»…) — пропускаем молча.
    if (month !== null) {
      issues.push({ column: null, message: 'Не найдена строка «День недели»' });
    }
    return { events: [], issues, needsYear: false };
  }

  const year = options.year ?? sheetYear(sheetName);
  if (year === null) {
    return {
      events: [],
      issues: [{ column: null, message: 'В названии листа нет года — выберите его' }],
      needsYear: true,
    };
  }

  const dateRow = weekdayRow - 1;
  const startRow = findRow(rows, weekdayRow, (l) => l.startsWith('время начала'));
  const arriveRow = findRow(rows, weekdayRow, (l) => l.startsWith('время прихода'));
  const adminRow = findRow(rows, weekdayRow, (l) => l === 'админ');
  const staffFrom = adminRow !== -1 ? adminRow : Math.max(weekdayRow, startRow, arriveRow) + 1;
  const staffEnd = findRow(rows, staffFrom, (l) => l.startsWith('оплата') || l.startsWith('концерт'));
  const rateRow = findRow(rows, staffFrom, (l) => l.startsWith('оплата'));
  const concertRow = findRow(rows, weekdayRow, (l) => l.startsWith('концерт'));
  const commentRow = findRow(rows, weekdayRow, (l) => l.startsWith('комментар'));

  const typeRow = findRow(rows, weekdayRow, (l) => l === 'вид мероприятия');

  const staffRows: Array<{ index: number; position: PositionName | null }> = [];
  if (staffEnd === -1) {
    issues.push({ column: null, message: 'Не найдена строка «Оплата» или «Концерт» — люди не разобраны' });
  } else {
    for (let i = staffFrom; i < staffEnd; i++) {
      const l = label(rows, i);
      if (!l) continue;
      if (Object.hasOwn(STAFF_LABELS, l)) {
        staffRows.push({ index: i, position: STAFF_LABELS[l] });
      } else if (IGNORED_STAFF_LABELS.has(l)) {
        // техтрек — молча пропускаем, без замечания
      } else {
        issues.push({ column: null, message: `Неизвестная строка «${text(rows[i][0])}» — пропущена` });
      }
    }
  }

  const events: ParsedEvent[] = [];
  const header = rows[dateRow] ?? [];
  // (дата, время начала) уникальны в базе — при коллизии внутри листа
  // (встречается у «ночных» с ошибочным временем) первая колонка остаётся,
  // остальные пропускаются с замечанием.
  const seenSlots = new Set<string>();

  for (let col = 1; col < header.length; col++) {
    const cell = header[col];
    if (cell === null || cell === undefined || (typeof cell === 'string' && !cell.trim())) continue;
    const shown = cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell).trim();

    const parsed = dayAndMonths(cell);
    if (!parsed || parsed.months.length === 0) {
      issues.push({ column: col, message: `Не разобрана дата «${shown}»` });
      continue;
    }
    const { date, warning } = resolveDate(parsed.day, parsed.months, month, year);
    if (!date) {
      issues.push({ column: col, message: `Несуществующая дата «${shown}»` });
      continue;
    }
    if (warning) issues.push({ column: col, message: `${date}: ${warning}` });

    const startTime = startRow === -1 ? null : timeOf(rows[startRow]?.[col]);
    if (!startTime) {
      issues.push({ column: col, message: `${date}: нет времени начала` });
      continue;
    }

    const slot = `${date} ${startTime}`;
    if (seenSlots.has(slot)) {
      issues.push({
        column: col,
        message: `${slot}: второе событие на то же время («${shown}») пропущено — проверьте время в таблице`,
      });
      continue;
    }
    seenSlots.add(slot);

    const tagWord = typeof cell === 'string'
      ? (cell.match(/\(([^)]+)\)/)?.[1] ?? '').trim().toLowerCase()
      : '';
    const tag = Object.hasOwn(TAGS, tagWord) ? TAGS[tagWord] : 'regular';

    const { rate, raw } = rateRow === -1 ? { rate: null, raw: null } : rateOf(rows[rateRow]?.[col]);
    if (raw) {
      issues.push({ column: col, message: `${date}: неоднозначная ставка «${raw}» — проставьте вручную` });
    }

    const staff: ParsedStaff[] = [];
    for (const { index, position } of staffRows) {
      const name = cleanName(text(rows[index]?.[col]));
      if (/\p{L}/u.test(name)) staff.push({ name, position });
    }

    events.push({
      date,
      startTime,
      arriveTime: arriveRow === -1 ? null : timeOf(rows[arriveRow]?.[col]),
      concert: concertRow === -1 ? null : text(rows[concertRow]?.[col]) || null,
      tag,
      ...(typeRow === -1 || !text(rows[typeRow]?.[col]) ? {} : {eventTypeName: text(rows[typeRow]?.[col])}),
      baseRate: rate,
      rawRate: raw,
      comment: commentRow === -1 ? null : text(rows[commentRow]?.[col]) || null,
      staff,
    });
  }

  return { events, issues, needsYear: false };
}
