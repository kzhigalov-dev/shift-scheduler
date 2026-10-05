import { beforeEach, expect, it } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { slotsFor } from './eventTypeFixtures';
import { saveEventType, getEventTypeSettings, setEventTypeArchived, resolveEventType, listEventTypes } from '@/lib/eventTypes/operations';
beforeEach(() => resetTestDb());
it('сохраняет отдельный состав и запрещает дубль имени из архива', async () => {
  const slots = await asManager(tx=>slotsFor(tx,{'АДМИН':1,'КАССА':1}));
  const id = await asManager(tx=>saveEventType(tx,{id:null,name:'Ёлка',slots}));
  const type = await asManager(tx=>getEventTypeSettings(tx,id));
  expect(type.slots.reduce((n,s)=>n+s.quantity,0)).toBe(2);
  await asManager(tx=>setEventTypeArchived(tx,id,true));
  await expect(asManager(tx=>saveEventType(tx,{id:null,name:'елка',slots}))).rejects.toThrow(/уже/);
  await expect(asManager(tx=>resolveEventType(tx,{id}))).rejects.toThrow(/архив/);
  expect((await asManager(tx=>resolveEventType(tx,{id,currentTypeId:id}))).id).toBe(id);
  await asManager(tx=>setEventTypeArchived(tx,id,false));
  expect((await asManager(tx=>resolveEventType(tx,{name:'  ЕЛКА '}))).id).toBe(id);
});
it('проверяет всю матрицу до изменения имени и количества', async () => {
  const slots = await asManager(tx=>slotsFor(tx,{}));
  const id = await asManager(tx=>saveEventType(tx,{id:null,name:'Нулевой',slots}));
  for (const invalid of [slots.slice(1),[...slots,slots[0]],slots.map((s,i)=>({...s,quantity:i===0?21:0}))]) {
    await expect(asManager(tx=>saveEventType(tx,{id,name:'Ошибочный',slots:invalid}))).rejects.toThrow();
  }
  expect((await asManager(tx=>getEventTypeSettings(tx,id))).name).toBe('Нулевой');
  expect(await testSql`select id from event_type where name='Ошибочный'`).toHaveLength(0);
});
it('переименовывает начальный вид, оставляя его классификацию', async () => {
  const type = await asManager(tx=>resolveEventType(tx,{systemTag:'night'}));
  const settings = await asManager(tx=>getEventTypeSettings(tx,type.id));
  await asManager(tx=>saveEventType(tx,{id:type.id,name:'Поздний вечер',slots:settings.slots}));
  expect((await asManager(tx=>resolveEventType(tx,{systemTag:'night'}))).name).toBe('Поздний вечер');
  expect(await asManager(tx=>listEventTypes(tx,{archived:false}))).toHaveLength(6);
});
it('не подменяет неизвестный вид и не принимает несколько способов поиска', async () => {
  await expect(asManager(tx=>resolveEventType(tx,{id:'нет'}))).rejects.toThrow();
  await expect(asManager(tx=>resolveEventType(tx,{name:'Неизвестный'}))).rejects.toThrow(/не найден/);
  await expect(asManager(tx=>resolveEventType(tx,{name:'обычное',systemTag:'regular'}))).rejects.toThrow();
});
