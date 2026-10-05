import { describe, it, expect } from 'vitest';
import { parseMonthSheet, sheetYear, type SheetRows } from '@/lib/import/parseSheet';

const july: SheetRows = [
  ['Даты', '1.7 (часовня)', 9.7, '9.7 (ночной)'],
  ['День недели', 'среда', 'четверг', 'четверг'],
  ['Время начала', '20:00', '20:00', '22:30'],
  ['Время прихода', '18:00', '18:00', '21:00'],
  ['Админ', 'Ян Образцовый', 'Ян Образцовый', 'Ян Образцовый'],
  ['РАБОТНИК', 'Семён Шаблонов', 'Андрей Макетный*', 'Андрей Макетный*'],
  ['РАБОТНИК', '', 'Илья Примерный', 'Кирилл Демонстрационный**'],
  ['КАССА', '', 'Полина Фиктивная', 'Полина Фиктивная'],
  ['Оплата', 1000, 1300, '1500/2000'],
  ['Концерт', 'Камерный концерт', 'Лунный свет', 'Ночная музыка кино'],
  ['Комментарии', '', 'Бах', ''],
  [null, null, null, null],
  ['Помощник по звуку', null, '9.7', '9.7'],
  ['Время прихода', null, 'к 16:30', 'к 23:50'],
  ['РАБОТНИК', null, 'Вова', 'Вова'],
  ['Оплата', null, 1300, 2000],
];

function withHeaderLabel(label: string | null): SheetRows {
  return [[label, ...july[0].slice(1)], ...july.slice(1)];
}

describe('parseMonthSheet: основной лист', () => {
  const { events, issues, needsYear } = parseMonthSheet(july, 'Июль 2026');

  it('разбирает даты из строки и из числа, год — из имени листа', () => {
    expect(needsYear).toBe(false);
    expect(events.map((e) => e.date)).toEqual(['2026-07-01', '2026-07-09', '2026-07-09']);
  });

  it('вытаскивает тег из скобок', () => {
    expect(events.map((e) => e.tag)).toEqual(['chapel', 'regular', 'night']);
  });

  it('различает события одного дня по времени начала', () => {
    expect(events.map((e) => e.startTime)).toEqual(['20:00', '20:00', '22:30']);
  });

  it('время прихода берёт из основного блока, а не из звукового', () => {
    expect(events[1].arriveTime).toBe('18:00');
  });

  it('админ и касса получают должности, РАБОТНИК — не расставлен', () => {
    expect(events[1].staff).toEqual([
      { name: 'Ян Образцовый', position: 'АДМИН' },
      { name: 'Андрей Макетный', position: null },
      { name: 'Илья Примерный', position: null },
      { name: 'Полина Фиктивная', position: 'КАССА' },
    ]);
  });

  it('пустые ячейки людей пропускает', () => {
    expect(events[0].staff).toEqual([
      { name: 'Ян Образцовый', position: 'АДМИН' },
      { name: 'Семён Шаблонов', position: null },
    ]);
  });

  it('звукача из нижнего блока не берёт', () => {
    const names = events.flatMap((e) => e.staff.map((s) => s.name));
    expect(names).not.toContain('Вова');
  });

  it('числовую ставку кладёт в baseRate, концерт и комментарий — в поля', () => {
    expect(events[1]).toMatchObject({
      baseRate: 1300, rawRate: null, concert: 'Лунный свет', comment: 'Бах',
    });
  });

  it('слипшуюся ставку не угадывает, а помечает', () => {
    expect(events[2]).toMatchObject({ baseRate: null, rawRate: '1500/2000' });
    expect(issues.some((i) => i.column === 3 && i.message.includes('ставк'))).toBe(true);
  });
});

describe('parseMonthSheet: варианты разметки', () => {
  it('строка дат подписана «Дата»', () => {
    expect(parseMonthSheet(withHeaderLabel('Дата'), 'Июль 2026').events).toHaveLength(3);
  });

  it('строка дат без подписи', () => {
    expect(parseMonthSheet(withHeaderLabel(null), 'Июль 2026').events).toHaveLength(3);
  });

  it('лист позиций: подписи строк — должности', () => {
    const rows: SheetRows = [
      ['Даты', '9.7'],
      ['День недели', 'четверг'],
      ['Время начала', '20:00'],
      ['Время прихода', '18:00'],
      ['Админ', 'Ян Образцовый'],
      ['ЗАЛ', 'Семён Шаблонов'],
      ['ВХОД В ЗАЛ', 'Илья Примерный'],
      ['БИЛЕТЫ', 'Андрей Макетный*'],
      ['БИЛЕТЫ', 'Кирилл Демонстрационный**'],
      ['КАССА', 'Полина Фиктивная'],
      ['Концерт', 'Лунный свет'],
    ];
    const [event] = parseMonthSheet(rows, 'Июль 2026 (позиции)').events;
    expect(event.baseRate).toBeNull();
    expect(event.staff).toEqual([
      { name: 'Ян Образцовый', position: 'АДМИН' },
      { name: 'Семён Шаблонов', position: 'ЗАЛ' },
      { name: 'Илья Примерный', position: 'ВХОД В ЗАЛ' },
      { name: 'Андрей Макетный', position: 'БИЛЕТЫ' },
      { name: 'Кирилл Демонстрационный', position: 'БИЛЕТЫ' },
      { name: 'Полина Фиктивная', position: 'КАССА' },
    ]);
  });

  it('незнакомую строку среди людей пропускает с замечанием', () => {
    const rows = [...july.slice(0, 5), ['ГАРДЕРОБ', 'А', 'Б', 'В'], ...july.slice(5)];
    const { events, issues } = parseMonthSheet(rows, 'Июль 2026');
    expect(events[1].staff.map((s) => s.name)).not.toContain('Б');
    expect(issues.some((i) => i.message.includes('ГАРДЕРОБ'))).toBe(true);
  });

  it('ячейки-даты и время-даты Excel', () => {
    const rows: SheetRows = [
      ['Даты', new Date(Date.UTC(2026, 6, 9))],
      ['День недели', 'четверг'],
      ['Время начала', new Date(Date.UTC(1899, 11, 30, 20, 0))],
      ['Время прихода', new Date(Date.UTC(1899, 11, 30, 18, 30))],
      ['Админ', 'Ян Образцовый'],
      ['Оплата', 1300],
    ];
    expect(parseMonthSheet(rows, 'Июль 2026').events[0]).toMatchObject({
      date: '2026-07-09', startTime: '20:00', arriveTime: '18:30',
    });
  });

  it('пустые колонки пропускает', () => {
    const rows = july.map((row) => [...row, '']);
    expect(parseMonthSheet(rows, 'Июль 2026').events).toHaveLength(3);
  });
});

describe('parseMonthSheet: техтрек, коллизии и ставки', () => {
  it('строки-техтрек (ПРОЕКТОР, ПОМОЩНИК ПО ЗВУКУ) среди людей пропускает молча', () => {
    const rows: SheetRows = [
      ['Даты', '9.7'],
      ['День недели', 'четверг'],
      ['Время начала', '20:00'],
      ['Админ', 'Ян Образцовый'],
      ['ПРОЕКТОР', 'Кто-то'],
      ['ПОМОЩНИК ПО ЗВУКУ', 'Вова'],
      ['Оплата', 1300],
    ];
    const { events, issues } = parseMonthSheet(rows, 'Июль 2026');
    expect(events[0].staff.map((s) => s.name)).toEqual(['Ян Образцовый']);
    expect(issues).toEqual([]);
  });

  it('незнакомую строку (не техтрек) по-прежнему помечает замечанием', () => {
    const rows: SheetRows = [
      ['Даты', '9.7'],
      ['День недели', 'четверг'],
      ['Время начала', '20:00'],
      ['Админ', 'Ян Образцовый'],
      ['ГАРДЕРОБ', 'Кто-то'],
      ['Оплата', 1300],
    ];
    const { events, issues } = parseMonthSheet(rows, 'Июль 2026');
    expect(events[0].staff.map((s) => s.name)).toEqual(['Ян Образцовый']);
    expect(issues.some((i) => i.message.includes('ГАРДЕРОБ'))).toBe(true);
  });

  it('коллизия (дата, время начала): первая колонка остаётся, вторая пропускается с замечанием', () => {
    const rows: SheetRows = [
      ['Даты', '27.6', '27.6 (ночной)'],
      ['День недели', 'четверг', 'четверг'],
      ['Время начала', '20:00', '20:00'],
      ['Админ', 'Ян Образцовый', 'Ян Образцовый'],
      ['Оплата', 1000, 1200],
    ];
    const { events, issues } = parseMonthSheet(rows, 'Июнь 2024');
    expect(events).toHaveLength(1);
    expect(events[0].baseRate).toBe(1000);
    expect(issues.some((i) => i.column === 2
      && i.message === '2024-06-27 20:00: второе событие на то же время («27.6 (ночной)») пропущено — проверьте время в таблице',
    )).toBe(true);
  });

  it('отрицательную числовую ставку не принимает, помечает как неоднозначную', () => {
    const rows: SheetRows = [
      ['Даты', '9.7'],
      ['День недели', 'четверг'],
      ['Время начала', '20:00'],
      ['Админ', 'Ян Образцовый'],
      ['Оплата', -500],
    ];
    const { events, issues } = parseMonthSheet(rows, 'Июль 2026');
    expect(events[0]).toMatchObject({ baseRate: null, rawRate: '-500' });
    expect(issues.some((i) => i.column === 1 && i.message.includes('ставк'))).toBe(true);
  });
});

describe('parseMonthSheet: год и месяц', () => {
  it('без года в имени листа просит год', () => {
    const result = parseMonthSheet(july, 'Июль');
    expect(result.needsYear).toBe(true);
    expect(result.events).toEqual([]);
  });

  it('год можно передать явно', () => {
    const { events } = parseMonthSheet(july, 'Июль', { year: 2023 });
    expect(events[0].date).toBe('2023-07-01');
  });

  it('январь на декабрьском листе уходит в следующий год', () => {
    const rows: SheetRows = [
      ['Даты', '30.12', '2.1', 3.1],
      ['День недели', 'пн', 'чт', 'пт'],
      ['Время начала', '20:00', '20:00', '20:00'],
    ];
    expect(parseMonthSheet(rows, 'Декабрь 2024').events.map((e) => e.date))
      .toEqual(['2024-12-30', '2025-01-02', '2025-01-03']);
  });

  it('число 1.1 на октябрьском листе — это 1 октября', () => {
    const rows: SheetRows = [
      ['Даты', 1.1],
      ['День недели', 'ср'],
      ['Время начала', '20:00'],
    ];
    expect(parseMonthSheet(rows, 'Октябрь 2025').events[0].date).toBe('2025-10-01');
  });

  it('несуществующую дату пропускает с замечанием', () => {
    const rows: SheetRows = [
      ['Даты', '31.6'],
      ['День недели', 'ср'],
      ['Время начала', '20:00'],
    ];
    const { events, issues } = parseMonthSheet(rows, 'Июнь 2026');
    expect(events).toEqual([]);
    expect(issues.some((i) => i.column === 1 && i.message.includes('Несуществующая'))).toBe(true);
  });

  it('лист не про месяц молча пропускает', () => {
    const rows: SheetRows = [['ФИО', 'Номер телефона'], ['Полина Фиктивная', null]];
    expect(parseMonthSheet(rows, 'Работники')).toEqual({ events: [], issues: [], needsYear: false });
  });

  it('sheetYear', () => {
    expect(sheetYear('Июль 2026 (позиции)')).toBe(2026);
    expect(sheetYear('Декабрь')).toBeNull();
  });
});
