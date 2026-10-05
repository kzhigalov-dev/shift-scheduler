import { describe, it, expect } from 'vitest';
import type { MonthPlan } from '@/lib/monthPlan/plan';
import {
  busyOn, cellKey, effectivePerson, eventPlaces, isEventFull, pickEventId, planFieldDisplay, planFieldValue,
  shiftTotals, sortedCounts,
  type Overrides,
} from '@/lib/monthPlan/planView';

const ian = { workerId: 'w-ian', fullName: 'Ян Образцовый' };
const pol = { workerId: 'w-pol', fullName: 'Полина Фиктивная' };
const arch = { workerId: 'w-old', fullName: 'Архивный Работник' };

const plan: MonthPlan = {
  month: '2099-07',
  status: 'draft',
  eventTypeOptions: [],
  columns: [
    { eventId: 'e1', date: '2099-07-03', startTime: '20:00', arriveTime: '18:00', arriveManual: false, concert: 'А', tag: 'regular', eventTypeId: 't1', eventTypeName: 'обычное', baseRate: 1300 },
    { eventId: 'e2', date: '2099-07-10', startTime: '20:00', arriveTime: '18:00', arriveManual: false, concert: 'Б', tag: 'regular', eventTypeId: 't1', eventTypeName: 'обычное', baseRate: 1300 },
  ],
  positions: [{ id: 'hall', name: 'ЗАЛ', rows: 1 }, { id: 'tix', name: 'БИЛЕТЫ', rows: 2 }],
  quantity: { e1: { hall: 1, tix: 2 }, e2: { hall: 1, tix: 1 } },
  people: { e1: { hall: [ian], tix: [null, arch] }, e2: { hall: [pol], tix: [null] } },
  unplaced: { e2: ['w-ian'] },
  workers: [pol, ian],
  signups: {},
};
const none: Overrides = new Map();

describe('effectivePerson', () => {
  it('правка важнее данных сервера, null — очищено', () => {
    const o: Overrides = new Map([[cellKey('e1', 'hall', 0), { person: null, token: 1 }]]);
    expect(effectivePerson(plan, none, 'e1', 'hall', 0)).toEqual(ian);
    expect(effectivePerson(plan, o, 'e1', 'hall', 0)).toBeNull();
    expect(effectivePerson(plan, none, 'e1', 'tix', 5)).toBeNull();
  });
});

describe('shiftTotals / sortedCounts', () => {
  it('считает ячейки и людей без должности, имена берёт и из ячеек', () => {
    const { counts, names } = shiftTotals(plan, none);
    expect(Object.fromEntries(counts)).toEqual({ 'w-ian': 2, 'w-old': 1, 'w-pol': 1 });
    expect(names.get('w-old')).toBe('Архивный Работник');
    expect(sortedCounts(counts, names)).toEqual([['w-ian', 2], ['w-old', 1], ['w-pol', 1]]);
  });
});

describe('busyOn', () => {
  it('должность или «без должности»', () => {
    expect(Object.fromEntries(busyOn(plan, none, 'e2'))).toEqual({ 'w-ian': 'без должности', 'w-pol': 'ЗАЛ' });
  });
});

describe('eventPlaces / isEventFull', () => {
  it('только активные места, подпись с номером у повторяющейся должности', () => {
    expect(eventPlaces(plan, none, 'e2').map((p) => [p.label, p.person?.workerId ?? null])).toEqual([
      ['ЗАЛ', 'w-pol'], ['БИЛЕТЫ', null],
    ]);
    expect(eventPlaces(plan, none, 'e1').map((p) => p.label)).toEqual(['ЗАЛ', 'БИЛЕТЫ 1', 'БИЛЕТЫ 2']);
  });

  it('занято ли всё', () => {
    expect(isEventFull(plan, none, 'e1')).toBe(false);
    const o: Overrides = new Map([[cellKey('e1', 'tix', 0), { person: pol, token: 1 }]]);
    expect(isEventFull(plan, o, 'e1')).toBe(true);
    expect(isEventFull({ ...plan, quantity: { e1: {} }, people: { e1: {} } }, none, 'e1')).toBe(false);
  });
});

describe('pickEventId', () => {
  const cols = plan.columns;
  it('запрошенное, если есть в месяце', () => {
    expect(pickEventId(cols, '2099-07-01', 'e2')).toBe('e2');
  });
  it('иначе первое с сегодняшнего дня, иначе первое', () => {
    expect(pickEventId(cols, '2099-07-05', 'чужое')).toBe('e2');
    expect(pickEventId(cols, '2099-07-01', null)).toBe('e1');
    expect(pickEventId(cols, '2099-08-01', null)).toBe('e1');
    expect(pickEventId([], '2099-08-01', null)).toBeNull();
  });
});

describe('planFieldValue / planFieldDisplay', () => {
  const full = plan.columns[0];
  const empty = { ...full, arriveTime: null, baseRate: null };
  it('значение для правки: строки как есть, пустое — пустая строка', () => {
    expect(planFieldValue(full, 'startTime')).toBe('20:00');
    expect(planFieldValue(full, 'arriveTime')).toBe('18:00');
    expect(planFieldValue(full, 'baseRate')).toBe('1300');
    expect(planFieldValue(empty, 'arriveTime')).toBe('');
    expect(planFieldValue(empty, 'baseRate')).toBe('');
  });
  it('показ: ставка — деньгами, пустое — «—»', () => {
    expect(planFieldDisplay(full, 'startTime')).toBe('20:00');
    expect(planFieldDisplay(full, 'baseRate')).toBe('1\u00a0300\u00a0₽');
    expect(planFieldDisplay(empty, 'arriveTime')).toBe('—');
    expect(planFieldDisplay(empty, 'baseRate')).toBe('—');
  });
});
