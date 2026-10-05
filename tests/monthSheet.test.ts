import { describe, it, expect } from 'vitest';
import {
  buildMonthSheet, exportFileName,
  type ExportCell, type ExportEvent, type MonthSheetInput, type MonthSheetModel,
} from '@/lib/export/monthSheet';

const PINK = 'FFF4CCCC';
const LILAC = 'FF8E7CC3';
const GREEN = 'FFD9EAD3';
const BLACK = 'FF000000';

const POSITIONS = [
  { id: 'admin', name: 'АДМИН' }, { id: 'hall', name: 'ЗАЛ' }, { id: 'hallDoor', name: 'ВХОД В ЗАЛ' },
  { id: 'tickets', name: 'БИЛЕТЫ' }, { id: 'balcony', name: 'БАЛКОН' }, { id: 'door', name: 'ВХОД' },
  { id: 'cash', name: 'КАССА' },
];

function event(date: string, startTime: string, over: Partial<ExportEvent> = {}): ExportEvent {
  return {
    date, startTime, arriveTime: null, concert: null, tag: 'regular', baseRate: null, comment: null,
    places: {}, unplaced: [], ...over,
  };
}

// Имена вымышленные. Мероприятия нарочно не по порядку: столбцы сортирует buildMonthSheet.
const input: MonthSheetInput = {
  month: '2099-10',
  positions: POSITIONS,
  events: [
    event('2099-10-03', '20:00', {
      arriveTime: '18:00', concert: 'Лунная соната', baseRate: 1300, comment: 'Вход со двора',
      places: {
        admin: ['Алиса Выдумкина'], hall: ['Вера Сказочная'], tickets: [null, 'Борис Небывалов'],
        balcony: ['Ева Несуществующая'],
      },
      unplaced: ['Глеб Придуманный', 'Дина Вымышленная'],
    }),
    event('2099-10-01', '19:30', {
      tag: 'organ', arriveTime: '17:30',
      places: { admin: [null], tickets: [null, null, null] },
    }),
  ],
};

const labels = (m: MonthSheetModel) => m.rows.map((r) => r.cells[0].value);
const values = (m: MonthSheetModel, label: string) => m.rows.find((r) => r.cells[0].value === label)?.cells.map((c) => c.value);
const cell = (m: MonthSheetModel, label: string, col: number, nth = 0): ExportCell =>
  m.rows.filter((r) => r.cells[0].value === label)[nth].cells[col];
/** Строки людей (Админ … РАБОТНИК) в колонке мероприятия: [значение, заливка]. */
const people = (m: MonthSheetModel, col: number) =>
  m.rows.slice(4, -3).map((r) => [r.cells[col].value, r.cells[col].style.fill]);

describe('buildMonthSheet', () => {
  it('имя листа и файла — месяц по-русски', () => {
    expect(buildMonthSheet(input).name).toBe('Октябрь 2099');
    expect(exportFileName('2099-10')).toBe('Анненкирхе — Октябрь 2099.xlsx');
  });

  it('подписи строк: должности по справочнику, у каждой — максимум мест, РАБОТНИК — по людям без должности', () => {
    expect(labels(buildMonthSheet(input))).toEqual([
      'Даты', 'День недели', 'Время начала', 'Время прихода', 'Админ',
      'ЗАЛ', 'ВХОД В ЗАЛ', 'БИЛЕТЫ', 'БИЛЕТЫ', 'БИЛЕТЫ', 'БАЛКОН', 'ВХОД', 'КАССА',
      'РАБОТНИК', 'РАБОТНИК', 'Оплата', 'Концерт', 'Комментарии',
    ]);
  });

  it('столбцы — по дате и времени начала', () => {
    const m = buildMonthSheet({
      month: '2099-10', positions: POSITIONS,
      events: [event('2099-10-03', '20:00'), event('2099-10-03', '11:00'), event('2099-10-01', '19:30')],
    });
    expect(values(m, 'Даты')).toEqual(['Даты', '1.10', '3.10', '3.10']);
    expect(values(m, 'Время начала')).toEqual(['Время начала', (19 * 60 + 30) / 1440, (11 * 60) / 1440, (20 * 60) / 1440]);
  });

  it('дата — строка д.м с тегом в скобках, заливка по тегу', () => {
    const m = buildMonthSheet({
      month: '2099-10', positions: POSITIONS,
      events: [
        event('2099-10-01', '20:00'), event('2099-10-02', '20:00', { tag: 'chapel' }),
        event('2099-10-03', '22:30', { tag: 'night' }), event('2099-10-04', '20:00', { tag: 'seder' }),
        event('2099-10-05', '19:30', { tag: 'organ' }), event('2099-10-06', '12:00', { tag: 'excursion' }),
      ],
    });
    expect(values(m, 'Даты')).toEqual([
      'Даты', '1.10', '2.10 (часовня)', '3.10 (ночной)', '4.10 (седер)', '5.10 (орган)', '6.10 (экскурсия)',
    ]);
    expect(m.rows[0].cells.map((c) => c.style.fill)).toEqual([
      'FFFFF2CC', 'FFFFF2CC', 'FFFFE599', 'FFD9D2E9', 'FF76A5AF', 'FFFCE5CD', 'FFFFE599',
    ]);
    expect(m.rows[0].cells.every((c) => c.style.numFmt === '@')).toBe(true);
  });

  it('день недели, время как доля суток, оплата, концерт, комментарий', () => {
    const m = buildMonthSheet(input);
    expect(values(m, 'День недели')).toEqual(['День недели', 'четверг', 'суббота']);
    expect(values(m, 'Время начала')).toEqual(['Время начала', 0.8125, (20 * 60) / 1440]);
    expect(values(m, 'Время прихода')).toEqual(['Время прихода', (17 * 60 + 30) / 1440, 0.75]);
    expect(cell(m, 'Время начала', 1).style.numFmt).toBe('h:mm');
    expect(cell(m, 'Время прихода', 1).style.numFmt).toBe('h:mm');
    expect(values(m, 'Оплата')).toEqual(['Оплата', null, 1300]);
    expect(values(m, 'Концерт')).toEqual(['Концерт', null, 'Лунная соната']);
    expect(values(m, 'Комментарии')).toEqual(['Комментарии', null, 'Вход со двора']);
  });

  it('нет прихода — пустая клетка', () => {
    const m = buildMonthSheet({ month: '2099-10', positions: POSITIONS, events: [event('2099-10-05', '12:00')] });
    expect(values(m, 'Время прихода')).toEqual(['Время прихода', null]);
  });

  it('люди по строкам: свободное место — в заливке строки, места нет — чёрная клетка', () => {
    const m = buildMonthSheet(input);
    // 1.10: админ — свободное место, БИЛЕТЫ — 3 свободных, остального нет.
    expect(people(m, 1)).toEqual([
      [null, PINK],
      [null, BLACK], [null, BLACK], [null, LILAC], [null, LILAC], [null, LILAC],
      [null, BLACK], [null, BLACK], [null, BLACK],
      [null, BLACK], [null, BLACK],
    ]);
    // 3.10: верхние 5 строк людей сиреневые, ниже — зелёные.
    expect(people(m, 2)).toEqual([
      ['Алиса Выдумкина', PINK],
      ['Вера Сказочная', LILAC], [null, BLACK], [null, LILAC], ['Борис Небывалов', LILAC], [null, BLACK],
      ['Ева Несуществующая', GREEN], [null, BLACK], [null, BLACK],
      ['Глеб Придуманный', GREEN], ['Дина Вымышленная', GREEN],
    ]);
  });

  it('нет людей без должности — нет строк РАБОТНИК', () => {
    const m = buildMonthSheet({ ...input, events: input.events.map((e) => ({ ...e, unplaced: [] })) });
    expect(labels(m)).not.toContain('РАБОТНИК');
  });

  it('месяц без мероприятий — только подписи, по строке на должность', () => {
    const m = buildMonthSheet({ month: '2099-11', positions: POSITIONS, events: [] });
    expect(m.name).toBe('Ноябрь 2099');
    expect(labels(m)).toEqual([
      'Даты', 'День недели', 'Время начала', 'Время прихода', 'Админ',
      'ЗАЛ', 'ВХОД В ЗАЛ', 'БИЛЕТЫ', 'БАЛКОН', 'ВХОД', 'КАССА', 'Оплата', 'Концерт', 'Комментарии',
    ]);
    expect(m.rows.every((r) => r.cells.length === 1)).toBe(true);
  });

  it('оформление — значения месячных листов исходной таблицы', () => {
    const m = buildMonthSheet(input);
    expect(m.rows[0].cells[0].style).toEqual({
      font: { name: 'Nunito', size: 9, bold: true }, fill: 'FFFFF2CC', border: 'all',
      horizontal: 'center', vertical: 'bottom', wrap: false, numFmt: '@',
    });
    expect(m.rows[4].cells[0].style).toEqual({
      font: { name: 'Nunito', size: 9, italic: true }, fill: PINK, border: 'all',
      horizontal: 'center', vertical: 'middle', wrap: false, numFmt: null,
    });
    expect(cell(m, 'ЗАЛ', 0).style).toEqual({
      font: { name: 'Nunito', size: 10 }, fill: null, border: 'all',
      horizontal: 'center', vertical: 'middle', wrap: true, numFmt: null,
    });
    expect(cell(m, 'Админ', 2).style).toEqual({
      font: { name: 'Nunito', size: 9, italic: true }, fill: PINK, border: 'all',
      horizontal: 'center', vertical: 'bottom', wrap: true, numFmt: null,
    });
    expect(cell(m, 'ЗАЛ', 2).style).toEqual({
      font: { name: 'Lora', size: 10 }, fill: LILAC, border: 'all',
      horizontal: 'center', vertical: 'middle', wrap: true, numFmt: null,
    });
    expect(cell(m, 'Время прихода', 2).style).toEqual({
      font: { name: 'Nunito', size: 10 }, fill: PINK, border: 'all',
      horizontal: 'center', vertical: 'bottom', wrap: false, numFmt: 'h:mm',
    });
    expect(cell(m, 'Оплата', 2).style).toEqual({
      font: { name: 'Montserrat', size: 10 }, fill: 'FFFFFFFF', border: 'all',
      horizontal: 'center', vertical: 'bottom', wrap: false, numFmt: null,
    });
    expect(cell(m, 'Концерт', 2).style).toEqual({
      font: { name: 'Nunito', size: 9 }, fill: null, border: 'all',
      horizontal: null, vertical: 'middle', wrap: true, numFmt: null,
    });
    expect(cell(m, 'Комментарии', 2).style).toEqual({
      font: { name: 'Nunito', size: 10, italic: true }, fill: null, border: 'bottom',
      horizontal: 'center', vertical: 'bottom', wrap: true, numFmt: null,
    });
    expect(cell(m, 'Комментарии', 1).style).toEqual({
      font: { name: 'Nunito', size: 10 }, fill: null, border: 'bottom',
      horizontal: null, vertical: 'bottom', wrap: true, numFmt: null,
    });
    expect(m.rows.map((r) => r.height)).toEqual([
      null, null, null, 18, 13.5, ...Array<number>(10).fill(16.5), 15.75, 34.5, 22.5,
    ]);
  });
});
