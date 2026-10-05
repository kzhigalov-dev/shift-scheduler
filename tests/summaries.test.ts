import { describe, it, expect } from 'vitest';
import { fillRate, pendingSummary, shortageSummary, payComparison } from '@/lib/summaries/month';
import { nextShift, freeThisWeek, earningsWindow, earningsBars } from '@/lib/summaries/worker';

const ev = (over: Partial<{ id: string; date: string; startTime: string; concert: string | null;
  needed: number; filled: number; pendingSignups: number; cancelRequests: number }>) => ({
  id: 'e', date: '2026-10-10', startTime: '19:00', concert: 'Концерт',
  needed: 0, filled: 0, pendingSignups: 0, cancelRequests: 0, ...over,
});

describe('fillRate — заполненность мест месяца', () => {
  it('сумма занятых мест из суммы нужных, процент вниз', () => {
    expect(fillRate([ev({ needed: 9, filled: 3 }), ev({ needed: 9, filled: 8 })]))
      .toEqual({ filled: 11, needed: 18, percent: 61 });
  });

  it('лишние люди сверх мест мероприятия не закрывают нехватку другого', () => {
    expect(fillRate([ev({ needed: 2, filled: 5 }), ev({ needed: 4, filled: 0 })]))
      .toEqual({ filled: 2, needed: 6, percent: 33 });
  });

  it('100 % — только когда заняты все места', () => {
    expect(fillRate([ev({ needed: 440, filled: 439 })]).percent).toBe(99);
    expect(fillRate([ev({ needed: 3, filled: 3 })]).percent).toBe(100);
  });

  it('без мест — процента нет', () => {
    expect(fillRate([])).toEqual({ filled: 0, needed: 0, percent: null });
    expect(fillRate([ev({ needed: 0, filled: 2 })])).toEqual({ filled: 0, needed: 0, percent: null });
  });
});

describe('pendingSummary — ждут решения', () => {
  it('считает заявки и отмены, мероприятия — по дате и времени', () => {
    const s = pendingSummary([
      ev({ id: 'b', date: '2026-10-12', pendingSignups: 1 }),
      ev({ id: 'x', date: '2026-10-11' }),
      ev({ id: 'a', date: '2026-10-05', startTime: '20:00', cancelRequests: 2 }),
      ev({ id: 'c', date: '2026-10-05', startTime: '12:00', pendingSignups: 3, cancelRequests: 1 }),
    ], 5);
    expect(s.signups).toBe(4);
    expect(s.cancels).toBe(3);
    expect(s.events.map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(s.more).toBe(0);
  });

  it('показывает не больше limit, остальное — числом', () => {
    const s = pendingSummary(['1', '2', '3', '4'].map((d) => ev({ id: d, date: `2026-10-0${d}`, pendingSignups: 1 })), 3);
    expect(s.events.map((e) => e.id)).toEqual(['1', '2', '3']);
    expect(s.more).toBe(1);
  });

  it('ничего не ждёт — пусто', () => {
    expect(pendingSummary([ev({})], 3)).toEqual({ signups: 0, cancels: 0, events: [], more: 0 });
  });
});

describe('shortageSummary — нехватка людей', () => {
  const item = (eventId: string, free: number) => ({ eventId, date: '2026-10-04', start: '19:00', concert: null, free });

  it('сколько людей не хватает и где', () => {
    expect(shortageSummary([item('a', 2), item('b', 1), item('c', 4)], 2)).toEqual({
      missing: 7, events: 3, shown: [item('a', 2), item('b', 1)], more: 1,
    });
  });

  it('нехватки нет', () => {
    expect(shortageSummary([], 3)).toEqual({ missing: 0, events: 0, shown: [], more: 0 });
  });
});

describe('payComparison — итог месяца к прошлому', () => {
  it('разница и процент, округлённый до целого', () => {
    expect(payComparison(115_000, 100_000)).toEqual({ delta: 15_000, percent: 15 });
    expect(payComparison(66_000, 99_000)).toEqual({ delta: -33_000, percent: -33 });
  });

  it('в прошлом месяце ничего — процента нет', () => {
    expect(payComparison(5_000, 0)).toEqual({ delta: 5_000, percent: null });
  });
});

const shift = (date: string, startTime = '19:00') => ({ date, startTime, eventId: `${date} ${startTime}` });

describe('nextShift — ближайшая смена', () => {
  it('первая с сегодняшнего дня, остальные — по порядку', () => {
    const { next, rest } = nextShift([shift('2026-10-09'), shift('2026-10-04', '20:00'), shift('2026-10-04', '12:00')], '2026-10-03');
    expect(next?.eventId).toBe('2026-10-04 12:00');
    expect(rest.map((s) => s.eventId)).toEqual(['2026-10-04 20:00', '2026-10-09 19:00']);
  });

  it('сегодняшняя смена — ближайшая, прошедшие отбрасываются', () => {
    const { next, rest } = nextShift([shift('2026-10-01'), shift('2026-10-03')], '2026-10-03');
    expect(next?.date).toBe('2026-10-03');
    expect(rest).toEqual([]);
  });

  it('смен нет', () => {
    expect(nextShift([], '2026-10-03')).toEqual({ next: null, rest: [] });
  });
});

describe('freeThisWeek — свободные на неделе', () => {
  const free = (date: string, signupStatus: 'pending' | 'accepted' | 'rejected' | null = null) => ({ date, signupStatus });

  it('неделя — семь дней с сегодняшнего; отклонённые не в счёт', () => {
    const items = [
      free('2026-10-03'), free('2026-10-09', 'pending'), free('2026-10-10'),
      free('2026-10-05', 'rejected'), free('2026-11-20'),
    ];
    const s = freeThisWeek(items, '2026-10-03');
    expect(s.week).toEqual([free('2026-10-03'), free('2026-10-09', 'pending')]);
    expect(s.total).toBe(4);
  });

  it('пусто', () => {
    expect(freeThisWeek([], '2026-10-03')).toEqual({ week: [], total: 0 });
  });
});

describe('earningsWindow — какие 6 месяцев показать', () => {
  it('выбран месяц в последних шести — окно кончается текущим', () => {
    expect(earningsWindow('2026-08', '2026-10')).toEqual({ from: '2026-05', to: '2026-10' });
    expect(earningsWindow('2026-10', '2026-10')).toEqual({ from: '2026-05', to: '2026-10' });
  });

  it('выбран месяц раньше — окно кончается им', () => {
    expect(earningsWindow('2025-12', '2026-10')).toEqual({ from: '2025-07', to: '2025-12' });
  });

  it('выбран будущий месяц — окно кончается им', () => {
    expect(earningsWindow('2027-01', '2026-10')).toEqual({ from: '2026-08', to: '2027-01' });
  });
});

describe('earningsBars — столбики заработка', () => {
  it('сумма и смены по месяцам окна, пустые месяцы — нули', () => {
    const bars = earningsBars([
      { date: '2026-09-02', amount: 1300 },
      { date: '2026-09-20', amount: 2000 },
      { date: '2026-10-01', amount: null },
      { date: '2026-10-02', amount: 0 },
      { date: '2026-05-31', amount: 1000 },
      { date: '2026-04-30', amount: 9999 },
    ], { from: '2026-05', to: '2026-10' });
    expect(bars).toEqual([
      { month: '2026-05', total: 1000, shifts: 1, unpriced: 0 },
      { month: '2026-06', total: 0, shifts: 0, unpriced: 0 },
      { month: '2026-07', total: 0, shifts: 0, unpriced: 0 },
      { month: '2026-08', total: 0, shifts: 0, unpriced: 0 },
      { month: '2026-09', total: 3300, shifts: 2, unpriced: 0 },
      { month: '2026-10', total: 0, shifts: 2, unpriced: 1 },
    ]);
  });

  it('через границу года', () => {
    expect(earningsBars([], { from: '2025-11', to: '2026-01' }).map((b) => b.month))
      .toEqual(['2025-11', '2025-12', '2026-01']);
  });
});
