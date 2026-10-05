import type { Tx } from '@/db/client';
import { beforeEach, expect, it } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { slotsFor, eventInput } from './eventTypeFixtures';
import { createEvent } from '@/lib/events';
import { saveEventType, setEventTypeArchived, resolveEventType } from '@/lib/eventTypes/operations';
import { previewTypeApply, applyTypeTemplate, previewEventApply, applyEventTemplate } from '@/lib/eventTypes/applyTemplate';
import { assignWorker } from '@/app/(manager)/event/[id]/operations';
const TODAY = '2099-09-15';
const before = {'ЗАЛ':3,'БИЛЕТЫ':3,'ВХОД':1};
const after = {'ЗАЛ':1,'БИЛЕТЫ':4,'БАЛКОН':1,'ВХОД':0};
beforeEach(() => resetTestDb());
async function worker(name: string): Promise<string> {
  const [w] = await testSql`insert into worker (full_name, name_key) values (${name}, ${name.toLowerCase()}) returning id`;
  return w.id as string;
}
const position = async (name: string) => (await testSql`select id from position where name=${name}`)[0].id as string;
const slots = (eventId: string) => testSql`select p.name,s.quantity,s.rate from event_slot s join position p on p.id=s.position_id
  where s.event_id=${eventId} order by p.sort_order`;
const people = (eventId: string) => testSql`select worker_id,position_id,rate,cancel_requested_at from assignment
  where event_id=${eventId} order by worker_id`;
/** Вид «Двор» с прежним составом, мероприятия на нём, затем шаблон меняется на новый. */
async function setup() {
  const typeId = await asManager(async tx=>saveEventType(tx,{id:null,name:'Двор',slots:await slotsFor(tx,before)}));
  const create = (date: string, eventTypeId: string) => asManager(tx=>createEvent(tx,{...eventInput,date,eventTypeId}));
  const future = await create('2099-10-01',typeId);
  const later = await create('2099-10-02',typeId);
  const today = await create(TODAY,typeId);
  const past = await create('2099-09-14',typeId);
  const regular = await asManager(tx=>resolveEventType(tx,{systemTag:'regular'}));
  const other = await create('2099-10-03',regular.id);
  const [hall,tickets,entrance] = [await position('ЗАЛ'),await position('БИЛЕТЫ'),await position('ВХОД')];
  const [anna,boris,vera] = [await worker('Анна'),await worker('Борис'),await worker('Вера')];
  await testSql`insert into assignment (worker_id,event_id,position_id,rate,cancel_requested_at)
    values (${anna},${future},${hall},1500,now()),(${boris},${future},${hall},null,null),(${vera},${future},null,null,null),
           (${anna},${past},${hall},null,null)`;
  await testSql`insert into signup (worker_id,event_id) values (${vera},${later})`;
  await testSql`update event_slot set rate=1700 where event_id=${future} and position_id=${tickets}`;
  await testSql`update event_slot set rate=1200 where event_id=${future} and position_id=${entrance}`;
  await asManager(async tx=>saveEventType(tx,{id:typeId,name:'Двор',slots:await slotsFor(tx,after)}));
  return {typeId,future,later,today,past,other};
}
it('предпросмотр вида показывает только будущие мероприятия этого вида и ничего не пишет', async () => {
  const s = await setup();
  const snapshot = await testSql`select * from event_slot order by event_id,position_id`;
  const preview = await asManager(tx=>previewTypeApply(tx,s.typeId,TODAY));
  expect(preview.typeName).toBe('Двор');
  expect(preview.unchanged).toBe(0);
  expect(preview.events.map(e=>e.eventId)).toEqual([s.today,s.future,s.later]);
  const first = preview.events.find(e=>e.eventId===s.future);
  // Без своей ставки у места — без приписки.
  expect(preview.events.find(e=>e.eventId===s.later)?.changes.find(c=>c.positionName==='ВХОД')?.label).toBe('ВХОД 1\u00a0→\u00a00');
  expect(first).toMatchObject({date:'2099-10-01',startTime:'20:00',concert:'Тестовый концерт'});
  expect(first?.changes.map(c=>[c.positionName,c.from,c.to,c.wanted,c.label])).toEqual([
    ['ЗАЛ',3,2,1,'ЗАЛ 3\u00a0→\u00a02 (стоят люди, меньше нельзя)'],
    ['БИЛЕТЫ',3,4,4,'БИЛЕТЫ 3\u00a0→\u00a04'],
    ['БАЛКОН',0,1,1,'БАЛКОН\u00a0+1'],
    ['ВХОД',1,0,0,'ВХОД 1\u00a0→\u00a00 (ставка места сбросится)'],
  ]);
  expect(await testSql`select * from event_slot order by event_id,position_id`).toEqual(snapshot);
});
it('применение к виду меняет только будущие мероприятия вида и никого не снимает', async () => {
  const s = await setup();
  const pastSlots = await slots(s.past);
  const otherSlots = await slots(s.other);
  const before = await people(s.future);
  const result = await asManager(tx=>applyTypeTemplate(tx,s.typeId,TODAY));
  expect(result.applied).toBe(3);
  expect(result.eventIds.sort()).toEqual([s.future,s.later,s.today].sort());
  expect(result.months).toEqual(['2099-09','2099-10']);
  expect(await slots(s.future)).toEqual([
    {name:'ЗАЛ',quantity:2,rate:null},{name:'БИЛЕТЫ',quantity:4,rate:1700},{name:'БАЛКОН',quantity:1,rate:null},
  ]);
  expect(await slots(s.later)).toEqual([
    {name:'ЗАЛ',quantity:1,rate:null},{name:'БИЛЕТЫ',quantity:4,rate:null},{name:'БАЛКОН',quantity:1,rate:null},
  ]);
  expect(await people(s.future)).toEqual(before);
  expect(await testSql`select status from signup where event_id=${s.later}`).toEqual([{status:'pending'}]);
  expect(await slots(s.past)).toEqual(pastSlots);
  expect(await slots(s.other)).toEqual(otherSlots);
  const [e] = await testSql`select event_type_id,base_rate,to_char(start_time,'HH24:MI') as start from event where id=${s.future}`;
  expect(e).toEqual({event_type_id:s.typeId,base_rate:1300,start:'20:00'});
});
it('повторное применение ничего не меняет', async () => {
  const s = await setup();
  await asManager(tx=>applyTypeTemplate(tx,s.typeId,TODAY));
  const snapshot = await testSql`select * from event_slot order by event_id,position_id`;
  expect(await asManager(tx=>applyTypeTemplate(tx,s.typeId,TODAY))).toEqual({applied:0,eventIds:[],months:[]});
  expect(await testSql`select * from event_slot order by event_id,position_id`).toEqual(snapshot);
  const preview = await asManager(tx=>previewTypeApply(tx,s.typeId,TODAY));
  expect(preview.events).toEqual([]);
  expect(preview.unchanged).toBe(3);
});
it('одиночное применение меняет только своё будущее мероприятие', async () => {
  const s = await setup();
  const preview = await asManager(tx=>previewEventApply(tx,s.future,TODAY));
  expect(preview).toMatchObject({eventId:s.future,typeId:s.typeId,typeName:'Двор'});
  expect(preview.changes.map(c=>c.label)).toEqual([
    'ЗАЛ 3\u00a0→\u00a02 (стоят люди, меньше нельзя)','БИЛЕТЫ 3\u00a0→\u00a04','БАЛКОН\u00a0+1','ВХОД 1\u00a0→\u00a00 (ставка места сбросится)',
  ]);
  const laterSlots = await slots(s.later);
  expect(await asManager(tx=>applyEventTemplate(tx,s.future,TODAY))).toEqual({applied:1,eventIds:[s.future],months:['2099-10']});
  expect((await slots(s.future)).map(r=>[r.name,r.quantity])).toEqual([['ЗАЛ',2],['БИЛЕТЫ',4],['БАЛКОН',1]]);
  expect(await slots(s.later)).toEqual(laterSlots);
  expect((await asManager(tx=>previewEventApply(tx,s.future,TODAY))).changes).toEqual([]);
  expect(await asManager(tx=>applyEventTemplate(tx,s.future,TODAY))).toEqual({applied:0,eventIds:[],months:[]});
});
it('прошедшее мероприятие не показывает разницу и не меняется', async () => {
  const s = await setup();
  const pastSlots = await slots(s.past);
  expect((await asManager(tx=>previewEventApply(tx,s.past,TODAY))).changes).toEqual([]);
  await expect(asManager(tx=>applyEventTemplate(tx,s.past,TODAY))).rejects.toThrow(/будущ/);
  expect(await slots(s.past)).toEqual(pastSlots);
});
it('архивный вид не применяется к мероприятиям целиком, но его мероприятие можно выровнять', async () => {
  const s = await setup();
  await asManager(tx=>setEventTypeArchived(tx,s.typeId,true));
  await expect(asManager(tx=>previewTypeApply(tx,s.typeId,TODAY))).rejects.toThrow(/архив/);
  await expect(asManager(tx=>applyTypeTemplate(tx,s.typeId,TODAY))).rejects.toThrow(/архив/);
  expect((await asManager(tx=>applyEventTemplate(tx,s.future,TODAY))).applied).toBe(1);
});
it('отклоняет некорректные и неизвестные ID', async () => {
  await expect(asManager(tx=>previewTypeApply(tx,'нет',TODAY))).rejects.toThrow(/Некорректный/);
  await expect(asManager(tx=>applyTypeTemplate(tx,'00000000-0000-0000-0000-000000000001',TODAY))).rejects.toThrow(/не найден/);
  await expect(asManager(tx=>previewEventApply(tx,'нет',TODAY))).rejects.toThrow(/Некорректн/);
  await expect(asManager(tx=>applyEventTemplate(tx,'00000000-0000-0000-0000-000000000001',TODAY))).rejects.toThrow(/не найдено/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
/** Как в eventTypeEvents.test.ts: второе соединение действительно ждёт первое, затем первое фиксируется. */
async function overlapping<A,B>(first: (tx: Tx) => Promise<A>, second: (tx: Tx) => Promise<B>): Promise<[A,B]> {
  const ready = deferred<number>();
  const secondPid = deferred<number>();
  const barrier = deferred<void>();
  const firstPromise = asManager(async tx => {
    const [row] = await tx<{pid:number}[]>`select pg_backend_pid() as pid`;
    const value = await first(tx);
    ready.resolve(row.pid);
    await barrier.promise;
    return value;
  });
  const firstPid = await ready.promise;
  const secondPromise = asManager(async tx => {
    const [row] = await tx<{pid:number}[]>`select pg_backend_pid() as pid`;
    secondPid.resolve(row.pid);
    return second(tx);
  });
  const finished = Promise.all([firstPromise,secondPromise]);
  void finished.catch(() => {});
  try {
    const pid = await secondPid.promise;
    await expect.poll(async () => {
      const [row] = await testSql<{blocked:boolean}[]>`select ${firstPid}=any(pg_blocking_pids(${pid})) as blocked`;
      return row.blocked;
    },{timeout:3000}).toBe(true);
  } finally { barrier.resolve(); }
  return finished;
}
it('назначение, начатое раньше применения, сохраняет место человека', async () => {
  const s = await setup();
  const [hall,gleb] = [await position('ЗАЛ'),await worker('Глеб')];
  await testSql`insert into assignment (worker_id,event_id,position_id) select id,${s.later},${hall} from worker where full_name='Борис'`;
  await overlapping(
    tx=>assignWorker(tx,{eventId:s.later,workerId:gleb,positionId:hall}),
    tx=>applyTypeTemplate(tx,s.typeId,TODAY),
  );
  expect((await slots(s.later)).find(r=>r.name==='ЗАЛ')?.quantity).toBe(2);
  expect(await testSql`select id from assignment where event_id=${s.later} and position_id=${hall}`).toHaveLength(2);
});
it('применение раньше назначения не даёт занять убранное место', async () => {
  const s = await setup();
  const [hall,gleb] = [await position('ЗАЛ'),await worker('Глеб')];
  await testSql`update event_slot set quantity=3 where event_id=${s.today} and position_id=${hall}`;
  await testSql`insert into assignment (worker_id,event_id,position_id) select id,${s.today},${hall} from worker where full_name='Борис'`;
  await overlapping(
    tx=>applyEventTemplate(tx,s.today,TODAY),
    async tx=>{await expect(assignWorker(tx,{eventId:s.today,workerId:gleb,positionId:hall})).rejects.toThrow(/мест нет/)},
  );
  expect((await slots(s.today)).find(r=>r.name==='ЗАЛ')?.quantity).toBe(1);
  expect(await testSql`select id from assignment where event_id=${s.today} and position_id=${hall}`).toHaveLength(1);
});
it('применение раньше назначения на удаляемое пустое место — назначение не находит места', async () => {
  const s = await setup();
  const [entrance,gleb] = [await position('ВХОД'),await worker('Глеб')];
  await overlapping(
    tx=>applyEventTemplate(tx,s.today,TODAY),
    async tx=>{await expect(assignWorker(tx,{eventId:s.today,workerId:gleb,positionId:entrance})).rejects.toThrow(/мест нет/)},
  );
  expect((await slots(s.today)).find(r=>r.name==='ВХОД')).toBeUndefined();
  expect(await testSql`select id from assignment where event_id=${s.today}`).toEqual([]);
});
it('люди на должности без строки места (старый импорт) — место создаётся по числу людей', async () => {
  const s = await setup();
  const entrance = await position('ВХОД');
  await testSql`delete from event_slot where event_id=${s.later} and position_id=${entrance}`;
  await testSql`insert into assignment (worker_id,event_id,position_id)
    select id,${s.later},${entrance} from worker where full_name in ('Анна','Борис')`;
  const preview = await asManager(tx=>previewEventApply(tx,s.later,TODAY));
  expect(preview.changes.find(c=>c.positionName==='ВХОД')).toMatchObject({from:0,to:2,wanted:0,label:'ВХОД +2 (по числу людей)'});
  await asManager(tx=>applyEventTemplate(tx,s.later,TODAY));
  expect((await slots(s.later)).find(r=>r.name==='ВХОД')).toEqual({name:'ВХОД',quantity:2,rate:null});
  expect(await testSql`select id from assignment where event_id=${s.later} and position_id=${entrance}`).toHaveLength(2);
});
