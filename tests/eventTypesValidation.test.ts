import { expect, it } from 'vitest';
import { normalizeTypeName, parseTypeForm } from '@/lib/eventTypes/validation';
const id = '00000000-0000-0000-0000-000000000001';
it('нормализует имя и ограничивает длину Unicode', () => {
  expect(normalizeTypeName('  Ёлка   ВЕЧЕР  ')).toEqual({ name:'Ёлка ВЕЧЕР', key:'елка вечер' });
  for (const s of ['', '   ', 'а'.repeat(81)]) expect(() => normalizeTypeName(s)).toThrow(/Название/);
  expect(normalizeTypeName('🌲'.repeat(80)).name).toHaveLength(160);
});
it('не принимает пустые, повторные, дробные, отрицательные и лишние количества', () => {
  for (const v of ['', ' ', '-1', '1.5', '21', 'NaN']) {
    const f = new FormData(); f.set('name','Проверка'); f.set('quantity:'+id,v);
    expect(() => parseTypeForm(f)).toThrow();
  }
  const f = new FormData(); f.set('name','Проверка'); f.append('quantity:'+id,'1'); f.append('quantity:'+id,'2');
  expect(() => parseTypeForm(f)).toThrow();
  f.delete('quantity:'+id);f.set('quantity:нет','1');expect(() => parseTypeForm(f)).toThrow();
});
it('разбирает ноль и ID, но отклоняет повреждённый ID', () => {
  const f = new FormData();f.set('name','Тест');f.set('quantity:'+id,'0');
  expect(parseTypeForm(f)).toEqual({id:null,name:'Тест',slots:[{positionId:id,quantity:0}]});
  f.set('id','нет');expect(() => parseTypeForm(f)).toThrow();
});

it('разбирает ставки должностей: пусто, ноль и целые рубли', () => {
  for (const [raw, want] of [['', null], ['0', 0], ['2000', 2000]] as const) {
    const f = new FormData(); f.set('name','Седер'); f.set('quantity:'+id,'1'); f.set('rate:'+id,raw);
    expect(parseTypeForm(f).slots[0]).toEqual({positionId:id,quantity:1,rate:want});
  }
});
it('отклоняет отрицательные, дробные, чрезмерные и повторные ставки', () => {
  for (const raw of ['-1', '1.5', '1000001', '1500/2000', 'NaN']) {
    const f = new FormData(); f.set('name','Седер'); f.set('quantity:'+id,'1'); f.set('rate:'+id,raw);
    expect(() => parseTypeForm(f)).toThrow();
  }
  const f = new FormData(); f.set('name','Седер'); f.set('quantity:'+id,'1');
  f.append('rate:'+id,'1500'); f.append('rate:'+id,'2000');
  expect(() => parseTypeForm(f)).toThrow();
});
