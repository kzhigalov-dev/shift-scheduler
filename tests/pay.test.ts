import { describe, it, expect } from 'vitest';
import { calculatePay, rateRange, shiftAmount, type PayInput } from '@/lib/pay/calculatePay';

const none = { personRate: null, slotRate: null, positionRate: null, eventRate: null };

function row(over: Partial<PayInput>): PayInput {
  return { workerId: 'w1', fullName: 'Илья Примерный', ...none, ...over };
}

describe('shiftAmount', () => {
  it('берёт ставку концерта, если больше ничего нет', () => {
    expect(shiftAmount({ ...none, eventRate: 1300 })).toBe(1300);
  });

  it('ставка должности по умолчанию важнее ставки концерта', () => {
    expect(shiftAmount({ ...none, positionRate: 2500, eventRate: 1300 })).toBe(2500);
  });

  it('ставка должности на концерте важнее ставки по умолчанию', () => {
    expect(shiftAmount({ ...none, slotRate: 1800, positionRate: 2500, eventRate: 1300 })).toBe(1800);
  });

  it('личная ставка важнее всего', () => {
    expect(shiftAmount({ personRate: 2400, slotRate: 1800, positionRate: 2500, eventRate: 1300 }))
      .toBe(2400);
  });

  it('явный 0 — это 0, а не «не задано»', () => {
    expect(shiftAmount({ ...none, personRate: 0, eventRate: 1300 })).toBe(0);
  });

  it('ничего не задано — null', () => {
    expect(shiftAmount(none)).toBeNull();
  });
});

describe('calculatePay', () => {
  it('суммирует смены человека', () => {
    expect(calculatePay([row({ eventRate: 1300 }), row({ eventRate: 2000 })])).toEqual([
      { workerId: 'w1', fullName: 'Илья Примерный', shifts: 2, total: 3300, unpriced: 0 },
    ]);
  });

  it('смену без ставки считает отдельно и в сумму не добавляет', () => {
    const [result] = calculatePay([row({}), row({ eventRate: 1300 })]);
    expect(result).toMatchObject({ shifts: 2, total: 1300, unpriced: 1 });
  });

  it('сортирует по убыванию суммы, при равенстве — по имени', () => {
    const result = calculatePay([
      row({ workerId: 'w1', fullName: 'Яна', eventRate: 1000 }),
      row({ workerId: 'w2', fullName: 'Артем', eventRate: 5000 }),
      row({ workerId: 'w3', fullName: 'Борис', eventRate: 1000 }),
    ]);
    expect(result.map((r) => r.fullName)).toEqual(['Артем', 'Борис', 'Яна']);
  });

  it('пустой вход — пустой выход', () => {
    expect(calculatePay([])).toEqual([]);
  });
});

describe('rateRange — ставка, которую видит работник до назначения (L6)', () => {
  const slot = (slotRate: number | null, positionRate: number | null = null) => ({ slotRate, positionRate });
  it('по местам мероприятия тем же порядком, что оплата: место (ручная или вида) → должность → мероприятие', () => {
    expect(rateRange([slot(2000), slot(1500)], null)).toEqual({ min: 1500, max: 2000 });
    expect(rateRange([slot(2000), slot(null)], 1000)).toEqual({ min: 1000, max: 2000 });
    expect(rateRange([slot(null, 1800)], 1000)).toEqual({ min: 1800, max: 1800 });
    expect(rateRange([slot(0)], 1000)).toEqual({ min: 0, max: 0 });
  });
  it('мест нет — базовая ставка мероприятия; ставок нет вовсе — null', () => {
    expect(rateRange([], 1300)).toEqual({ min: 1300, max: 1300 });
    expect(rateRange([], null)).toBeNull();
    expect(rateRange([slot(null), slot(2000)], null)).toEqual({ min: 2000, max: 2000 });
    expect(rateRange([slot(null)], null)).toBeNull();
  });
});
