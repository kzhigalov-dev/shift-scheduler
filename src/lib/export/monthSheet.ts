import type { EventTag } from '@/lib/import/parseSheet';
import { TAG_LABELS } from '@/lib/eventTags';
import { monthTitle } from '@/lib/month';

/** Должность справочника; порядок — position.sort_order. */
export type ExportPosition = { id: string; name: string };

/** Мероприятие месяца для выгрузки. */
export type ExportEvent = {
  date: string;
  startTime: string;
  arriveTime: string | null;
  concert: string | null;
  tag: EventTag;
  eventTypeName?: string;
  baseRate: number | null;
  comment: string | null;
  /** positionId → места по строкам: имя или null (свободное место). Длина — мест у мероприятия (больше, если людей больше). */
  places: Record<string, ReadonlyArray<string | null>>;
  /** Люди без должности. */
  unplaced: string[];
};

export type MonthSheetInput = { month: string; positions: ExportPosition[]; events: ExportEvent[] };

export type CellStyle = {
  font: { name: 'Nunito' | 'Lora' | 'Montserrat'; size: number; bold?: true; italic?: true };
  /** ARGB; null — без заливки. */
  fill: string | null;
  /** all — тонкая рамка со всех сторон, bottom — только снизу. */
  border: 'all' | 'bottom';
  /** null — по умолчанию (общее). */
  horizontal: 'center' | null;
  vertical: 'top' | 'middle' | 'bottom';
  wrap: boolean;
  /** null — General. */
  numFmt: string | null;
};
export type ExportCell = { value: string | number | null; style: CellStyle };
/** cells[0] — подпись (колонка A); height: null — высота по умолчанию листа. */
export type ExportRow = { height: number | null; cells: ExportCell[] };
export type MonthSheetModel = { name: string; rows: ExportRow[] };

/** Лист целиком — как месячные листы исходной таблицы (`.superpowers/sdd/month-sheet-format.md`, §2.1). */
export const SHEET_FORMAT = {
  tabColor: 'FFFFA0CE',
  defaultRowHeight: 15.75,
  defaultColWidth: 12.63,
  labelColWidth: 12.63,
  eventColWidth: 12.25,
  fontColor: 'FF000000',
  borderColor: 'FF000000',
} as const;

const PINK = 'FFF4CCCC';
const CREAM = 'FFFFF2CC';
const LILAC = 'FF8E7CC3';
const GREEN = 'FFD9EAD3';
const WHITE = 'FFFFFFFF';
/** Места, которого у мероприятия нет. */
const BLACK = 'FF000000';
/** Строк людей под «Админ», залитых сиреневым; ниже — зелёные (цвет — по месту строки в блоке, как в исходных листах). */
const LILAC_ROWS = 5;
const ADMIN = 'АДМИН';

const TAG_FILLS: Record<EventTag, string> = {
  regular: 'FFFFF2CC', night: 'FFD9D2E9', organ: 'FFFCE5CD',
  chapel: 'FFFFE599', seder: 'FF76A5AF', excursion: 'FFFFE599',
};

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'] as const;

function style(font: CellStyle['font'], over: Partial<Omit<CellStyle, 'font'>> = {}): CellStyle {
  return {
    font, fill: null, border: 'all', horizontal: 'center', vertical: 'bottom', wrap: false, numFmt: null, ...over,
  };
}

/** Подписи строк (колонка A). */
const LABEL = {
  date: style({ name: 'Nunito', size: 9, bold: true }, { fill: CREAM, numFmt: '@' }),
  weekday: style({ name: 'Nunito', size: 9 }),
  start: style({ name: 'Nunito', size: 9 }),
  arrive: style({ name: 'Nunito', size: 9 }, { fill: PINK }),
  admin: style({ name: 'Nunito', size: 9, italic: true }, { fill: PINK, vertical: 'middle' }),
  staff: style({ name: 'Nunito', size: 10 }, { vertical: 'middle', wrap: true }),
  rate: style({ name: 'Montserrat', size: 10 }),
  concert: style({ name: 'Nunito', size: 9 }, { vertical: 'middle' }),
  comment: style({ name: 'Nunito', size: 9, italic: true }, { vertical: 'middle' }),
};

/** Клетки мероприятий (колонки B…). */
const CELL = {
  weekday: style({ name: 'Nunito', size: 9 }),
  start: style({ name: 'Nunito', size: 9 }, { numFmt: 'h:mm' }),
  arrive: style({ name: 'Nunito', size: 10 }, { fill: PINK, numFmt: 'h:mm' }),
  admin: style({ name: 'Nunito', size: 9, italic: true }, { fill: PINK, wrap: true }),
  rate: style({ name: 'Montserrat', size: 10 }, { fill: WHITE }),
  concert: style({ name: 'Nunito', size: 9 }, { horizontal: null, vertical: 'middle', wrap: true }),
  comment: style({ name: 'Nunito', size: 10, italic: true }, { border: 'bottom', wrap: true }),
  noComment: style({ name: 'Nunito', size: 10 }, { border: 'bottom', horizontal: null, wrap: true }),
};

const dateStyle = (tag: EventTag) => style({ name: 'Nunito', size: 9, bold: true }, { fill: TAG_FILLS[tag], numFmt: '@' });
const personStyle = (blockRow: number) => style(
  { name: 'Lora', size: 10 }, { fill: blockRow < LILAC_ROWS ? LILAC : GREEN, vertical: 'middle', wrap: true },
);

const HEIGHT = { arrive: 18, admin: 13.5, staff: 16.5, rate: 15.75, concert: 34.5, comment: 22.5 } as const;

/** «1.10», «5.10 (орган)» — строкой, как читает parseSheet (число 1.10 превратилось бы в 1.1). */
function dateText(e: ExportEvent): string {
  const [, m, d] = e.date.split('-').map(Number);
  return e.tag === 'regular' ? `${d}.${m}` : `${d}.${m} (${TAG_LABELS[e.tag]})`;
}

function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** «19:30» → доля суток; в листе — с форматом h:mm. */
function dayFraction(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h * 60 + m) / 1440;
}

/** Клетка места: человек или свободное место — в заливке строки; места у мероприятия нет — чёрная. */
function place(places: ReadonlyArray<string | null> | undefined, index: number, s: CellStyle): ExportCell {
  if (!places || index >= places.length) return { value: null, style: { ...s, fill: BLACK } };
  return { value: places[index], style: s };
}

/** Имя файла выгрузки: «Анненкирхе — Октябрь 2026.xlsx». */
export function exportFileName(month: string): string {
  return `Анненкирхе — ${monthTitle(month)}.xlsx`;
}

/**
 * Месяц → описание листа в виде месячного листа исходной таблицы («с позициями»):
 * колонка A — подписи, далее по колонке на мероприятие. Без exceljs — только значения и стили.
 */
export function buildMonthSheet(input: MonthSheetInput): MonthSheetModel {
  const events = [...input.events]
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const row = (label: string, labelStyle: CellStyle, height: number | null, cell: (e: ExportEvent) => ExportCell): ExportRow =>
    ({ height, cells: [{ value: label, style: labelStyle }, ...events.map(cell)] });
  const most = (count: (e: ExportEvent) => number) => Math.max(0, ...events.map(count));

  const people: ExportRow[] = [];
  const admin = input.positions.find((p) => p.name === ADMIN);
  const adminPlaces = (e: ExportEvent) => (admin ? e.places[admin.id] : undefined);
  const adminRows = Math.max(1, most((e) => adminPlaces(e)?.length ?? 0));
  for (let r = 0; r < adminRows; r++) {
    people.push(row('Админ', LABEL.admin, HEIGHT.admin, (e) => place(adminPlaces(e), r, CELL.admin)));
  }

  let blockRow = 0;
  for (const p of input.positions.filter((x) => x.name !== ADMIN)) {
    const rows = Math.max(1, most((e) => e.places[p.id]?.length ?? 0));
    for (let r = 0; r < rows; r++) {
      const s = personStyle(blockRow++);
      people.push(row(p.name, LABEL.staff, HEIGHT.staff, (e) => place(e.places[p.id], r, s)));
    }
  }

  const unplacedRows = most((e) => e.unplaced.length);
  for (let r = 0; r < unplacedRows; r++) {
    const s = personStyle(blockRow++);
    people.push(row('РАБОТНИК', LABEL.staff, HEIGHT.staff, (e) => place(e.unplaced, r, s)));
  }

  return {
    name: monthTitle(input.month),
    rows: [
      row('Даты', LABEL.date, null, (e) => ({ value: dateText(e), style: dateStyle(e.tag) })),
      row('День недели', LABEL.weekday, null, (e) => ({ value: weekday(e.date), style: CELL.weekday })),
      row('Время начала', LABEL.start, null, (e) => ({ value: dayFraction(e.startTime), style: CELL.start })),
      row('Время прихода', LABEL.arrive, HEIGHT.arrive, (e) => ({
        value: e.arriveTime === null ? null : dayFraction(e.arriveTime), style: CELL.arrive,
      })),
      ...people,
      row('Оплата', LABEL.rate, HEIGHT.rate, (e) => ({ value: e.baseRate, style: CELL.rate })),
      row('Концерт', LABEL.concert, HEIGHT.concert, (e) => ({ value: e.concert, style: CELL.concert })),
      row('Комментарии', LABEL.comment, HEIGHT.comment, (e) => (e.comment
        ? { value: e.comment, style: CELL.comment }
        : { value: null, style: CELL.noComment })),
      ...(events.some(e=>e.eventTypeName !== undefined && e.eventTypeName !== TAG_LABELS[e.tag])
        ? [row('Вид мероприятия',LABEL.concert,HEIGHT.concert,e=>({value:e.eventTypeName ?? TAG_LABELS[e.tag],style:CELL.concert}))]
        : []),
    ],
  };
}
