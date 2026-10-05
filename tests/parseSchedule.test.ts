import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseScheduleSheet, parseTimes, scheduleSheets } from '@/lib/schedule/parseSchedule';
import { readWorkbook } from '@/lib/import/workbook';
import type { SheetCell, SheetRows } from '@/lib/import/parseSheet';

const HEADER = ['дата', null, 'направление', 'площадка', 'организатор', 'название', 'начало',
  'БЗ', 'кирха', 'Запуск', 'идет', 'исполнители', 'готовность афиши', 'комментарий '];
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const t = (hh: number, mm: number) => new Date(Date.UTC(1899, 11, 30, hh, mm));

type Extra = { launch?: SheetCell; goes?: SheetCell; performers?: SheetCell; comment?: SheetCell };
function row(
  date: SheetCell, direction: string, venue: string, organizer: string, title: string, start: SheetCell,
  extra: Extra = {},
): SheetCell[] {
  return [date, 'пн', direction, venue, organizer, title, start, null, null,
    extra.launch ?? null, extra.goes ?? null, extra.performers ?? null, null, extra.comment ?? null];
}
const sheet = (...rows: SheetCell[][]): SheetRows => [[null, null, null, null, null, 'ИЮЛЬ'], HEADER, ...rows];

describe('parseTimes', () => {
  it('время-дата, доля суток, текст с одним и несколькими временами', () => {
    expect(parseTimes(t(20, 30))).toEqual(['20:30']);
    expect(parseTimes(new Date(Date.UTC(1899, 11, 30, 20, 29, 59, 999)))).toEqual(['20:30']);
    expect(parseTimes(0.5)).toEqual(['12:00']);
    expect(parseTimes('20:00\n22:30')).toEqual(['20:00', '22:30']);
    expect(parseTimes('9.15')).toEqual(['09:15']);
  });

  it('непонятное — пусто', () => {
    expect(parseTimes('уточняется')).toEqual([]);
    expect(parseTimes(null)).toEqual([]);
    expect(parseTimes(2)).toEqual([]);
  });
});

describe('parseScheduleSheet', () => {
  it('не расписание — null', () => {
    expect(parseScheduleSheet('рао', [['дата', 'организатор', 'Что, где, кто', 'начало']])).toBeNull();
    expect(parseScheduleSheet('пусто', sheet())).toBeNull();
  });

  it('только строки с датами — месяц без мероприятий', () => {
    const s = parseScheduleSheet('ноябрь 26', sheet(
      row(d('2026-11-01'), '', '', '', '', null),
      row(d('2026-11-02'), '', '', '', '', null),
      row(d('2026-11-03'), '', '', '', '', null),
    ));
    expect(s).toEqual({ name: 'ноябрь 26', month: '2026-11', events: [] });
  });

  it('единственное мероприятие на ПУШКИНЕ — месяц без мероприятий', () => {
    const s = parseScheduleSheet('ноябрь 26', sheet(
      row(d('2026-11-01'), '', '', '', '', null),
      row(d('2026-11-04'), 'концерт', 'ПУШКИН', 'арт-зерно', 'Резонанс эпох', t(18, 0)),
    ));
    expect(s).toEqual({ name: 'ноябрь 26', month: '2026-11', events: [] });
  });

  it('месяц — по всем датам листа, включая пропущенные строки; при равенстве — более ранний', () => {
    const s = parseScheduleSheet('ноябрь 26', sheet(
      row(d('2026-11-01'), '', '', '', '', null),
      row(d('2026-11-02'), '', '', '', '', null),
      row(d('2026-12-01'), 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Декабрьский', t(20, 0)),
    ));
    expect(s?.month).toBe('2026-11');
    expect(s?.events.map((e) => [e.title, e.issue])).toEqual([['Декабрьский', 'Дата не из месяца листа']]);

    const tie = parseScheduleSheet('ноябрь 26', sheet(
      row(d('2026-12-01'), '', '', '', '', null),
      row(d('2026-11-30'), '', '', '', '', null),
    ));
    expect(tie?.month).toBe('2026-11');
  });

  it('заголовок без единой даты — null', () => {
    expect(parseScheduleSheet('пусто', sheet(
      row('завтра', 'концерт', 'ПУШКИН', 'арт-зерно', 'Без даты', t(18, 0)),
    ))).toBeNull();
  });

  it('колонки ищутся по заголовку, а не по букве', () => {
    const shifted: SheetRows = [
      [null, ...HEADER],
      [null, ...row(d('2026-07-02'), 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Музыка из кино', t(20, 0))],
    ];
    const s = parseScheduleSheet('июль 26', shifted);
    expect(s?.events.map((e) => [e.key, e.title])).toEqual([['2026-07-02|20:00', 'Музыка из кино']]);
  });

  it('два времени и две строки названия — два мероприятия со своим запуском', () => {
    const s = parseScheduleSheet('июль 26', sheet(
      row(d('2026-07-03'), 'концерт', 'АННЕНКИРХЕ', 'арт-зерно2', 'Лунный свет\nНочной орган', '20:00\n22:30',
        { launch: '19:15\n22:00', goes: '1 ч 15 мин\nкафе до 22:30', performers: 'Иван Тестов', comment: 'Проверка' }),
    ));
    expect(s?.month).toBe('2026-07');
    expect(s?.events.map(({ key, title, tag, arriveTime, checked, comment }) =>
      ({ key, title, tag, arriveTime, checked, comment }))).toEqual([
      { key: '2026-07-03|20:00', title: 'Лунный свет', tag: 'regular', arriveTime: '18:00', checked: true,
        comment: 'Запуск: 19:15\nИдёт: 1 ч 15 мин; кафе до 22:30\nИсполнители: Иван Тестов\nКомментарий: Проверка' },
      { key: '2026-07-03|22:30', title: 'Ночной орган', tag: 'night', arriveTime: '21:00', checked: true,
        comment: 'Запуск: 22:00\nИдёт: 1 ч 15 мин; кафе до 22:30\nИсполнители: Иван Тестов\nКомментарий: Проверка' },
    ]);
  });

  it('число строк названия не совпадает со временами — название целиком', () => {
    const s = parseScheduleSheet('июль 26', sheet(
      row(d('2026-07-04'), 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Голос Диснея\nМузыка из кино\nбонус', '19:30\n22:30'),
    ));
    expect(s?.events.map((e) => e.title)).toEqual([
      'Голос Диснея / Музыка из кино / бонус', 'Голос Диснея / Музыка из кино / бонус',
    ]);
  });

  it('галочки: Арт-Зерно и концерт/ужин/экскурсия; Аккорд, репетиция, приход — без', () => {
    const s = parseScheduleSheet('июль 26', sheet(
      row(d('2026-07-01'), 'концерт', 'АННЕНКИРХЕ', 'аккорд', 'Вивальди', t(22, 30)),
      row(d('2026-07-06'), 'репетиция', 'АННЕНКИРХЕ', 'арт-зерно', 'репа', t(10, 0)),
      row(d('2026-07-08'), 'приход', 'АННЕНКИРХЕ', 'приход', 'Богослужение', t(19, 0)),
      row(d('2026-07-06'), 'ужин', 'АННЕНКИРХЕ', 'арт-зерно', 'Тайная вечеря', t(20, 0)),
      row(d('2026-07-08'), 'экскурсия', 'Анненкирхе ', 'Арт-Зерно', 'Экскурсия', t(21, 0)),
    ));
    expect(s?.events.map((e) => e.checked)).toEqual([false, false, false, true, true]);
  });

  it('совместное «арт&аккорд» — без галочки', () => {
    const s = parseScheduleSheet('июль 26', sheet(
      row(d('2026-07-09'), 'концерт', 'АННЕНКИРХЕ', 'арт&аккорд', 'Совместный вечер', t(20, 0)),
    ));
    expect(s?.events.map((e) => [e.title, e.issue, e.checked])).toEqual([['Совместный вечер', null, false]]);
  });

  it('ПУШКИН и пустые строки не попадают в список', () => {
    const s = parseScheduleSheet('июль 26', sheet(
      row(d('2026-07-04'), 'концерт', 'ПУШКИН', 'арт-зерно', 'Резонанс эпох', t(18, 0)),
      row(null, '', '', '', '', null),
      row(d('2026-07-05'), 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Музыка из кино', t(20, 0)),
    ));
    expect(s?.events.map((e) => e.title)).toEqual(['Музыка из кино']);
  });

  it('строка только с датой (без площадки, названия и начала) пропускается молча', () => {
    const s = parseScheduleSheet('июль 26', sheet(
      row(d('2026-07-04'), '', '', '', '', null),
      row(d('2026-07-05'), 'концерт', '', 'арт-зерно', '', null, { comment: 'уточнить' }),
      row(d('2026-07-06'), 'концерт', '', 'арт-зерно', 'Без площадки', null),
      row(d('2026-07-07'), '', '', '', '', t(20, 0)),
    ));
    expect(s?.events.map((e) => [e.date, e.title, e.issue])).toEqual([
      ['2026-07-06', 'Без площадки', 'Не указана площадка'],
      ['2026-07-07', '', 'Не указана площадка'],
    ]);
  });

  it('проблемные строки — с причиной и без галочки', () => {
    const s = parseScheduleSheet('июль 26', sheet(
      row(d('2026-07-09'), 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Без времени', 'уточняется'),
      row(d('2026-07-10'), 'концерт', '', 'арт-зерно', 'Без площадки', t(20, 0)),
      row('завтра', 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Кривая дата', t(20, 0)),
      row(d('2026-08-01'), 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Чужой месяц', t(20, 0)),
      row(d('2026-07-11'), 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Первое', t(20, 0)),
      row(d('2026-07-11'), 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', 'Второе', t(20, 0)),
    ));
    expect(s?.events.map((e) => [e.title, e.issue, e.checked])).toEqual([
      ['Без времени', 'Не понятно время начала: «уточняется»', false],
      ['Без площадки', 'Не указана площадка', false],
      ['Кривая дата', 'Не понятна дата: «завтра»', false],
      ['Чужой месяц', 'Дата не из месяца листа', false],
      ['Первое', null, true],
      ['Второе', 'На это время уже есть мероприятие (строка 7)', false],
    ]);
    const keys = s?.events.map((e) => e.key) ?? [];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('файл расписания целиком', () => {
  it('подходящие листы и разбор «июль 26»', async () => {
    const file = readFileSync(path.resolve(__dirname, 'fixtures/schedule.xlsx'));
    const sheets = scheduleSheets(await readWorkbook(file));
    expect(sheets.map((s) => [s.name, s.month])).toEqual([
      ['июль 26', '2026-07'], ['ноя 98', '2098-11'], ['дек 98', '2098-12'], ['янв 99', '2099-01'],
    ]);
    expect(sheets[3].events).toEqual([]);
    expect(sheets[0].events.map((e) => [e.date, e.startTime, e.title, e.tag, e.arriveTime, e.checked, e.issue]))
      .toEqual([
        ['2026-07-01', '19:00', 'Богослужение в БЗ', 'regular', '17:00', false, null],
        ['2026-07-01', '20:30', 'Концерт в часовне', 'chapel', '18:30', true, null],
        ['2026-07-01', '22:30', 'Вивальди. Времена года', 'night', '21:00', false, null],
        ['2026-07-03', '20:00', 'Лунный свет', 'regular', '18:00', true, null],
        ['2026-07-03', '22:30', 'Ночной орган в Анненкирхе', 'night', '21:00', true, null],
        ['2026-07-06', '10:00', 'репа в бз орган', 'regular', '08:00', false, null],
        ['2026-07-06', '20:00', 'Тайная вечеря', 'seder', '18:00', true, null],
        ['2026-07-07', '20:00', 'органный вторник под луной', 'organ', '18:00', true, null],
        ['2026-07-08', '21:00', 'Ночная экскурсия по церкви', 'excursion', '20:30', true, null],
        ['2026-07-09', '', 'Музыка из кино', 'regular', '', false, 'Не понятно время начала: «уточняется»'],
        ['2026-07-10', '20:00', 'Без площадки', 'regular', '18:00', false, 'Не указана площадка'],
        ['2026-08-01', '20:00', 'Чужой месяц', 'regular', '18:00', false, 'Дата не из месяца листа'],
      ]);
    expect(sheets[0].events[1].comment).toBe('Запуск: 20:00\nИдёт: 1 час; кафе до 22:00');
  });
});
