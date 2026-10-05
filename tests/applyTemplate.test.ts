import { expect, it } from 'vitest';
import { planTemplateApply, changeLabel } from '@/lib/eventTypes/applyTemplate';
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
it('увеличивает места до шаблона', () => {
  expect(planTemplateApply([{positionId:A,quantity:3,people:1}],[{positionId:A,quantity:4}]))
    .toEqual({changes:[{positionId:A,from:3,to:4,wanted:4}],changed:true});
});
it('уменьшает места только до числа людей на должности', () => {
  expect(planTemplateApply([{positionId:A,quantity:3,people:2}],[{positionId:A,quantity:1}]))
    .toEqual({changes:[{positionId:A,from:3,to:2,wanted:1}],changed:true});
  expect(planTemplateApply([{positionId:A,quantity:3,people:0}],[{positionId:A,quantity:1}]).changes)
    .toEqual([{positionId:A,from:3,to:1,wanted:1}]);
});
it('добавляет должность, которой нет у мероприятия', () => {
  expect(planTemplateApply([],[{positionId:B,quantity:1}]).changes).toEqual([{positionId:B,from:0,to:1,wanted:1}]);
});
it('убирает пустую должность, которой нет в шаблоне', () => {
  expect(planTemplateApply([{positionId:C,quantity:1,people:0}],[{positionId:C,quantity:0}]).changes)
    .toEqual([{positionId:C,from:1,to:0,wanted:0}]);
  expect(planTemplateApply([{positionId:C,quantity:2,people:0}],[]).changes).toEqual([{positionId:C,from:2,to:0,wanted:0}]);
});
it('ноль в шаблоне не снимает людей', () => {
  expect(planTemplateApply([{positionId:A,quantity:3,people:2}],[{positionId:A,quantity:0}]).changes)
    .toEqual([{positionId:A,from:3,to:2,wanted:0}]);
  expect(planTemplateApply([{positionId:A,quantity:2,people:2}],[{positionId:A,quantity:0}]))
    .toEqual({changes:[],changed:false});
});
it('без изменений — пустой список', () => {
  expect(planTemplateApply(
    [{positionId:A,quantity:3,people:3},{positionId:B,quantity:0,people:0}],
    [{positionId:A,quantity:3},{positionId:B,quantity:0},{positionId:C,quantity:0}],
  )).toEqual({changes:[],changed:false});
});
it('лишних людей сверх мест сохраняет: места растут до числа людей', () => {
  expect(planTemplateApply([{positionId:A,quantity:1,people:2}],[{positionId:A,quantity:1}]).changes)
    .toEqual([{positionId:A,from:1,to:2,wanted:1}]);
});
it('идёт по порядку шаблона, затем — должности мероприятия вне шаблона', () => {
  const plan = planTemplateApply(
    [{positionId:C,quantity:1,people:0},{positionId:A,quantity:1,people:0}],
    [{positionId:B,quantity:2},{positionId:A,quantity:2}],
  );
  expect(plan.changes.map(c=>c.positionId)).toEqual([B,A,C]);
});
it('подписывает изменения как в окне применения', () => {
  expect(changeLabel('БИЛЕТЫ',{from:3,to:4,wanted:4})).toBe('БИЛЕТЫ 3\u00a0→\u00a04');
  expect(changeLabel('БАЛКОН',{from:0,to:1,wanted:1})).toBe('БАЛКОН\u00a0+1');
  expect(changeLabel('ВХОД',{from:1,to:0,wanted:0})).toBe('ВХОД 1\u00a0→\u00a00');
  expect(changeLabel('ЗАЛ',{from:3,to:2,wanted:1})).toBe('ЗАЛ 3\u00a0→\u00a02 (стоят люди, меньше нельзя)');
  // Места растут до числа людей — не «меньше нельзя».
  expect(changeLabel('ЗАЛ',{from:1,to:2,wanted:1})).toBe('ЗАЛ 1\u00a0→\u00a02 (по числу людей)');
  expect(changeLabel('ЗАЛ',{from:0,to:2,wanted:0})).toBe('ЗАЛ\u00a0+2 (по числу людей)');
  // Удаляемое место со своей ставкой; ставка без удаления — без приписки.
  expect(changeLabel('ВХОД',{from:1,to:0,wanted:0},true)).toBe('ВХОД 1\u00a0→\u00a00 (ставка места сбросится)');
  expect(changeLabel('БИЛЕТЫ',{from:3,to:4,wanted:4},true)).toBe('БИЛЕТЫ 3\u00a0→\u00a04');
});
