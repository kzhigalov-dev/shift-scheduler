import { describe, it, expect } from 'vitest';
import {
  addDays, currentMonth, currentDate, isMonth, monthName, monthParam, monthShort, shiftMonth, monthRange, monthTitle, monthWeeks,
} from '@/lib/month';

describe('month', () => {
  it('текущий месяц считается по Москве', () => {
    // 31 июля 22:30 UTC — в Москве уже 1 августа
    expect(currentMonth(new Date('2026-07-31T22:30:00Z'))).toBe('2026-08');
  });

  it('берёт месяц из параметра или текущий', () => {
    const now = new Date('2026-07-15T12:00:00Z');
    expect(monthParam('2025-12', now)).toBe('2025-12');
    expect(monthParam('2025-13', now)).toBe('2026-07');
    expect(monthParam(['2025-12'], now)).toBe('2026-07');
    expect(monthParam(undefined, now)).toBe('2026-07');
  });

  it('отвергает нулевой год — не похожий на месяц мусор', () => {
    const now = new Date('2026-07-15T12:00:00Z');
    expect(monthParam('0000-01', now)).toBe('2026-07');
  });

  it('сдвигает через границу года', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('даёт полуоткрытый диапазон дат', () => {
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });

  it('пишет название месяца по-русски', () => {
    expect(monthTitle('2026-07')).toBe('Июль 2026');
  });
  it('текущая дата — по Москве, а не по UTC', () => {
    expect(currentDate(new Date('2026-07-31T22:30:00Z'))).toBe('2026-08-01');
    expect(currentDate(new Date('2026-07-15T12:00:00Z'))).toBe('2026-07-15');
  });

  it('раскладывает месяц по неделям с понедельника', () => {
    // Июль 2026: 1-е — среда, 31-е — пятница; 5 недель.
    const weeks = monthWeeks('2026-07');
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]).toBe('2026-06-29');
    expect(weeks[0][2]).toBe('2026-07-01');
    expect(weeks[4][6]).toBe('2026-08-02');
  });

  it('месяц, начинающийся с понедельника, не получает лишней недели спереди', () => {
    // Июнь 2026: 1-е — понедельник, 30-е — вторник; 5 недель.
    const weeks = monthWeeks('2026-06');
    expect(weeks[0][0]).toBe('2026-06-01');
    expect(weeks).toHaveLength(5);
    // Февраль 2027: 1-е — понедельник, 28-е — воскресенье; ровно 4 недели.
    expect(monthWeeks('2027-02')).toHaveLength(4);
  });
  it('текущая дата: граница суток по Москве — ровно 21:00 UTC', () => {
    expect(currentDate(new Date('2026-07-31T20:59:59Z'))).toBe('2026-07-31');
    expect(currentDate(new Date('2026-07-31T21:00:00Z'))).toBe('2026-08-01');
  });

  it('март 2026 (1-е — воскресенье) занимает 6 недель', () => {
    const weeks = monthWeeks('2026-03');
    expect(weeks).toHaveLength(6);
    expect(weeks[0][0]).toBe('2026-02-23');
    expect(weeks[0][6]).toBe('2026-03-01');
    expect(weeks[5][0]).toBe('2026-03-30');
    expect(weeks[5][6]).toBe('2026-04-05');
  });

  it('февраль 2026 начинается с воскресенья, хвост — до 1 марта', () => {
    const weeks = monthWeeks('2026-02');
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toBe('2026-01-26');
    expect(weeks[0][6]).toBe('2026-02-01');
    expect(weeks[4][5]).toBe('2026-02-28');
    expect(weeks[4][6]).toBe('2026-03-01');
  });

  it('високосный февраль 2028 содержит 29 февраля', () => {
    const weeks = monthWeeks('2028-02');
    expect(weeks.flat()).toContain('2028-02-29');
    expect(weeks[0][0]).toBe('2028-01-31');
    expect(weeks.at(-1)?.[6]).toBe('2028-03-05');
    expect(weeks.flat().filter((d) => d.startsWith('2028-02'))).toHaveLength(29);
  });
});

describe('isMonth', () => {
  it('только YYYY-MM с месяцем 01–12', () => {
    expect(isMonth('2026-10')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth('2026-1')).toBe(false);
    expect(isMonth('../x')).toBe(false);
  });
});

describe('названия месяцев и сдвиг даты', () => {
  it('monthName — со строчной, в именительном и предложном', () => {
    expect(monthName('2026-10')).toBe('октябрь');
    expect(monthName('2026-10', 'prepositional')).toBe('октябре');
    expect(monthName('2026-05', 'prepositional')).toBe('мае');
    expect(monthName('2026-08', 'prepositional')).toBe('августе');
  });

  it('monthShort — коротко для подписи столбика', () => {
    expect(monthShort('2026-10')).toBe('окт.');
    expect(monthShort('2026-05')).toBe('май');
  });

  it('addDays — через границы месяца и года', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
