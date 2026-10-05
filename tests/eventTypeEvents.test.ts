import type { Tx } from '@/db/client';
import { beforeEach, expect, it } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { slotsFor, eventInput } from './eventTypeFixtures';
import { createEvent, updateEvent } from '@/lib/events';
import { saveEventType, setEventTypeArchived, resolveEventType } from '@/lib/eventTypes/operations';
beforeEach(() => resetTestDb());
it('копирует состав выбранного вида, последующие изменения не меняют старые места', async () => {
  const id = await asManager(async tx=>saveEventType(tx,{id:null,name:'Двор',slots:await slotsFor(tx,{'ЗАЛ':2})}));
  const e = await asManager(tx=>createEvent(tx,{...eventInput,eventTypeId:id,tag:'night'}));
  const [row] = await testSql`select tag,arrive_time::text from event where id=${e}`;
  expect(row).toEqual({tag:'regular',arrive_time:'18:00:00'});
  const slots = await testSql`select * from event_slot where event_id=${e}`;
  expect(slots).toHaveLength(1); expect(slots[0].quantity).toBe(2);
  await asManager(async tx=>saveEventType(tx,{id,name:'Во дворе',slots:await slotsFor(tx,{'АДМИН':1,'ЗАЛ':4})}));
  expect(await testSql`select * from event_slot where event_id=${e}`).toEqual(slots);
  const night = await asManager(tx=>resolveEventType(tx,{systemTag:'night'}));
  await asManager(tx=>updateEvent(tx,e,{...eventInput,eventTypeId:night.id}));
  expect(await testSql`select * from event_slot where event_id=${e}`).toEqual(slots);
});
it('отклоняет устаревшую форму нового события, но сохраняет прежний архивный вид', async () => {
  const type = await asManager(tx=>resolveEventType(tx,{systemTag:'regular'}));
  const e = await asManager(tx=>createEvent(tx,{...eventInput,eventTypeId:type.id}));
  await asManager(tx=>setEventTypeArchived(tx,type.id,true));
  await expect(asManager(tx=>createEvent(tx,{...eventInput,date:'2099-10-02',eventTypeId:type.id}))).rejects.toThrow(/архив/);
  await asManager(tx=>updateEvent(tx,e,{...eventInput,concert:'Правка',eventTypeId:type.id}));
  expect(await testSql`select id from event`).toHaveLength(1);
  const night = await asManager(tx=>resolveEventType(tx,{systemTag:'night'}));
  await asManager(tx=>setEventTypeArchived(tx,night.id,true));
  await expect(asManager(tx=>updateEvent(tx,e,{...eventInput,eventTypeId:night.id}))).rejects.toThrow(/архив/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
/** Наблюдаем настоящую блокировку второго соединения, затем разрешаем commit первого. */
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
it('создание ждёт сохранения шаблона и получает полную новую версию', async () => {
  const type = await asManager(tx=>resolveEventType(tx,{systemTag:'regular'}));
  const [,e] = await overlapping(
    async tx=>saveEventType(tx,{id:type.id,name:'Обычное',slots:await slotsFor(tx,{'ЗАЛ':4,'КАССА':2})}),
    tx=>createEvent(tx,{...eventInput,eventTypeId:type.id}),
  );
  const rows = await testSql`select p.name,s.quantity from event_slot s join position p on p.id=s.position_id where event_id=${e} order by p.sort_order`;
  expect(rows).toEqual([{name:'ЗАЛ',quantity:4},{name:'КАССА',quantity:2}]);
});
it('создание, начатое до сохранения шаблона, сохраняет целиком старый состав', async () => {
  const type = await asManager(tx=>resolveEventType(tx,{systemTag:'regular'}));
  const [e] = await overlapping(
    tx=>createEvent(tx,{...eventInput,eventTypeId:type.id}),
    async tx=>saveEventType(tx,{id:type.id,name:'Обычное',slots:await slotsFor(tx,{'ЗАЛ':4})}),
  );
  const [row] = await testSql`select sum(quantity)::int as n from event_slot where event_id=${e}`;
  expect(row.n).toBe(9);
});
it('архивация раньше создания блокирует и отклоняет новое мероприятие', async () => {
  const type = await asManager(tx=>resolveEventType(tx,{systemTag:'regular'}));
  await overlapping(
    tx=>setEventTypeArchived(tx,type.id,true),
    async tx=>{await expect(createEvent(tx,{...eventInput,eventTypeId:type.id})).rejects.toThrow(/архив/)},
  );
  expect(await testSql`select id from event`).toHaveLength(0);
});
it('создание раньше архивации завершается с выбранным составом', async () => {
  const type = await asManager(tx=>resolveEventType(tx,{systemTag:'regular'}));
  const [e] = await overlapping(
    tx=>createEvent(tx,{...eventInput,eventTypeId:type.id}),
    tx=>setEventTypeArchived(tx,type.id,true),
  );
  const [row] = await testSql`select sum(quantity)::int as n from event_slot where event_id=${e}`;
  expect(row.n).toBe(9);
});
