import { describe, expect, it } from 'vitest';
import { parseDistributionRows } from '@/lib/distribute/rows';
import { distribute, overLimit, overLimitLabel, shuffle, type FreeSlot, type RandomInt } from '@/lib/distribute/distribute';

/** Повторяемый источник: линейный конгруэнтный генератор с заданным зерном. */
function seeded(seed: number): RandomInt {
  let state = seed;
  return (max) => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state % max;
  };
}
/** Всегда первый вариант: shuffle с ним — детерминированная перестановка. */
const first: RandomInt = () => 0;

const ADMIN: FreeSlot = { positionId: 'admin', name: 'АДМИН', free: 1 };
const HALL: FreeSlot = { positionId: 'hall', name: 'ЗАЛ', free: 2 };
const TICKETS: FreeSlot = { positionId: 'tickets', name: 'БИЛЕТЫ', free: 3 };
const people = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`);
const count = (rows: Array<{ positionId: string | null }>, id: string | null) => rows.filter((r) => r.positionId === id).length;

describe('shuffle', () => {
  it('перестановка тех же элементов, вход не меняется', () => {
    const items = people(10);
    const copy = [...items];
    const result = shuffle(items, seeded(7));
    expect(items).toEqual(copy);
    expect([...result].sort()).toEqual([...items].sort());
  });

  it('спрашивает у источника номера в допустимых пределах', () => {
    const asked: number[] = [];
    shuffle(people(4), (max) => { asked.push(max); return max - 1; });
    expect(asked).toEqual([4, 3, 2]);
  });
});

describe('distribute', () => {
  it('АДМИН никогда не заполняется', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rows = distribute(people(10), [ADMIN, HALL, TICKETS], seeded(seed));
      expect(count(rows, 'admin')).toBe(0);
    }
  });

  it('мест не больше квоты, все места заняты, если людей хватает', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rows = distribute(people(5), [HALL, TICKETS], seeded(seed));
      expect(count(rows, 'hall')).toBe(2);
      expect(count(rows, 'tickets')).toBe(3);
      expect(count(rows, null)).toBe(0);
    }
  });

  it('лишние люди остаются без должности', () => {
    const rows = distribute(people(8), [ADMIN, HALL, TICKETS], seeded(3));
    expect(rows).toHaveLength(8);
    expect(count(rows, 'hall')).toBe(2);
    expect(count(rows, 'tickets')).toBe(3);
    expect(count(rows, null)).toBe(3);
  });

  it('мест больше, чем людей, — каждый получает должность, лишние места остаются', () => {
    const rows = distribute(people(2), [HALL, TICKETS], seeded(11));
    expect(count(rows, null)).toBe(0);
    expect(count(rows, 'hall')).toBeLessThanOrEqual(2);
    expect(count(rows, 'tickets')).toBeLessThanOrEqual(3);
  });

  it('строки — в порядке входа, по одной на человека', () => {
    const input = people(6);
    expect(distribute(input, [HALL, TICKETS], seeded(5)).map((r) => r.workerId)).toEqual(input);
  });

  it('при заданном источнике результат повторяется', () => {
    const a = distribute(people(6), [HALL, TICKETS], seeded(42));
    const b = distribute(people(6), [HALL, TICKETS], seeded(42));
    expect(a).toEqual(b);
    // Источник «всегда 0»: места и люди переставлены предсказуемо.
    expect(distribute(['a', 'b', 'c'], [{ positionId: 'x', name: 'X', free: 1 }, { positionId: 'y', name: 'Y', free: 1 }], first))
      .toEqual([{ workerId: 'a', positionId: null }, { workerId: 'b', positionId: 'y' }, { workerId: 'c', positionId: 'x' }]);
  });

  it('разные источники дают разные варианты', () => {
    const variants = new Set(Array.from({ length: 20 }, (_, i) =>
      JSON.stringify(distribute(people(5), [HALL, TICKETS], seeded(i + 1)))));
    expect(variants.size).toBeGreaterThan(1);
  });

  it('без мест или без людей — пусто по должностям', () => {
    expect(distribute(people(2), [], seeded(1))).toEqual([
      { workerId: 'w1', positionId: null }, { workerId: 'w2', positionId: null },
    ]);
    expect(distribute(people(2), [ADMIN, { ...HALL, free: 0 }, { ...TICKETS, free: -1 }], seeded(1))
      .every((r) => r.positionId === null)).toBe(true);
    expect(distribute([], [HALL], seeded(1))).toEqual([]);
  });
});

describe('overLimit', () => {
  const free = [ADMIN, HALL, TICKETS];

  it('в пределах мест — пусто', () => {
    expect(overLimit([
      { positionId: 'hall' }, { positionId: 'hall' }, { positionId: 'tickets' }, { positionId: null }, { positionId: null },
    ], free)).toEqual([]);
  });

  it('должность выбрана большему числу людей, чем мест', () => {
    expect(overLimit([
      { positionId: 'hall' }, { positionId: 'hall' }, { positionId: 'hall' },
      { positionId: 'tickets' }, { positionId: 'tickets' }, { positionId: 'tickets' }, { positionId: 'tickets' },
    ], free)).toEqual([
      { positionId: 'hall', name: 'ЗАЛ', free: 2, chosen: 3 },
      { positionId: 'tickets', name: 'БИЛЕТЫ', free: 3, chosen: 4 },
    ]);
  });

  it('АДМИН — всегда превышение', () => {
    expect(overLimit([{ positionId: 'admin' }], free)).toEqual([{ positionId: 'admin', name: 'АДМИН', free: 0, chosen: 1 }]);
  });

  it('подпись', () => {
    expect(overLimitLabel({ name: 'БИЛЕТЫ', free: 3 })).toBe('На БИЛЕТЫ мест: 3');
  });
});

describe('parseDistributionRows', () => {
  const E = '00000000-0000-4000-8000-000000000001';
  const W = '00000000-0000-4000-8000-000000000002';
  const P = '00000000-0000-4000-8000-000000000003';
  const BAD = 'Некорректный запрос';

  it('принимает строки с uuid и должностью или null', () => {
    expect(parseDistributionRows([{ eventId: E, workerId: W, positionId: P }, { eventId: E, workerId: P, positionId: null }]))
      .toEqual([{ eventId: E, workerId: W, positionId: P }, { eventId: E, workerId: P, positionId: null }]);
    expect(parseDistributionRows([])).toEqual([]);
  });

  it('лишние поля отбрасываются', () => {
    expect(parseDistributionRows([{ eventId: E, workerId: W, positionId: P, rate: 1 }])).toEqual([{ eventId: E, workerId: W, positionId: P }]);
  });

  it.each([
    ['не массив', { rows: [] }],
    ['строка', 'x'],
    ['null', null],
    ['строка-не объект', [1]],
    ['null в массиве', [null]],
    ['массив в массиве', [[E, W, P]]],
    ['не uuid', [{ eventId: 'x', workerId: W, positionId: P }]],
    ['нет должности', [{ eventId: E, workerId: W }]],
    ['должность — число', [{ eventId: E, workerId: W, positionId: 1 }]],
    ['работник — не строка', [{ eventId: E, workerId: 5, positionId: P }]],
  ])('отклоняет: %s', (_name, value) => {
    expect(() => parseDistributionRows(value)).toThrow(BAD);
  });

  it('не больше 500 строк', () => {
    const row = { eventId: E, workerId: W, positionId: null };
    expect(parseDistributionRows(Array.from({ length: 500 }, () => row))).toHaveLength(500);
    expect(() => parseDistributionRows(Array.from({ length: 501 }, () => row))).toThrow(BAD);
  });
});
