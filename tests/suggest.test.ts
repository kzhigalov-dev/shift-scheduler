import { describe, it, expect } from 'vitest';
import { suggest } from '@/lib/monthPlan/suggest';

const workers = [
  { workerId: 'a', fullName: 'Ян Образцовый' },
  { workerId: 'b', fullName: 'Андрей Макетный' },
  { workerId: 'c', fullName: 'Полина Фиктивная' },
];
const ctx = (over: Partial<Parameters<typeof suggest>[1]> = {}) => ({
  workers, signups: new Set<string>(), shifts: new Map<string, number>(), busy: new Map<string, string>(), ...over,
});

describe('suggest', () => {
  it('пустой запрос — все, подавшие заявку первыми, дальше по алфавиту', () => {
    const list = suggest('', ctx({ signups: new Set(['c']) }));
    expect(list.map((s) => (s.kind === 'worker' ? s.id : s.name))).toEqual(['c', 'b', 'a']);
  });

  it('слова запроса в любом порядке, без регистра и ё', () => {
    const list = suggest('образцовый ян', ctx());
    expect(list.map((s) => (s.kind === 'worker' ? s.id : 'new'))).toEqual(['a']);
  });

  it('число смен и занятость на мероприятии', () => {
    const [first] = suggest('Ян', ctx({ shifts: new Map([['a', 4]]), busy: new Map([['a', 'ЗАЛ']]) }));
    expect(first).toEqual({ kind: 'worker', id: 'a', fullName: 'Ян Образцовый', shifts: 4, signup: false, busy: 'ЗАЛ' });
  });

  it('нет точного совпадения — пункт «Добавить работника»', () => {
    expect(suggest('  Мария   Л. ', ctx()).at(-1)).toEqual({ kind: 'new', name: 'Мария Л.' });
    expect(suggest('Образцовый Ян', ctx()).some((s) => s.kind === 'new')).toBe(false);
  });

  it('не больше восьми работников', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ workerId: String(i), fullName: `Работник ${i}` }));
    expect(suggest('', ctx({ workers: many })).filter((s) => s.kind === 'worker')).toHaveLength(8);
  });
});
