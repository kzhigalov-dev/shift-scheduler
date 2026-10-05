import { beforeEach, expect, it } from 'vitest';
import type { Tx } from '@/db/client';
import { resetTestDb, testSql, asManager, asWorker, asAppAnon } from './setup';
import { eventInput, slotsFor } from './eventTypeFixtures';
import { saveEventType, getEventTypeSettings } from '@/lib/eventTypes/operations';
import { createEvent, updateEvent } from '@/lib/events';
import { setSlot, getEventCard, assignWorker } from '@/app/(manager)/event/[id]/operations';
import { payForMonth } from '@/app/(manager)/pay/queries';
import { myEarnings, monthShifts } from '@/app/(worker)/queries';
import { applyEventTemplate, applyTypeTemplate } from '@/lib/eventTypes/applyTemplate';
import { applyImport } from '@/lib/import/applyImport';
import { addDays } from '@/lib/month';

/**
 * «Сегодня» и «уже началось» — по часам базы (Europe/Moscow), как в коде (L7): даты считаются от неё,
 * а не подставляются параметром. Мероприятия: вчера 20:00, сегодня 00:00 (уже началось), завтра и
 * послезавтра 20:00.
 */
let TODAY: string;
beforeEach(async () => {
  await resetTestDb();
  [{ today: TODAY }] = await testSql<{ today: string }[]>`
    select to_char((now() at time zone 'Europe/Moscow')::date, 'YYYY-MM-DD') as today`;
});

async function save(tx: Tx, id: string | null, rate: number | null) {
  const slots = (await slotsFor(tx, { 'ЗАЛ': 1, 'БИЛЕТЫ': 1 })).map(s => ({ ...s, rate }));
  return saveEventType(tx, { id, name: 'Седер тест', slots });
}
async function setup() {
  const typeId = await asManager(tx => save(tx, null, 2000));
  const dates = { past: addDays(TODAY, -1), started: TODAY, future: addDays(TODAY, 1), later: addDays(TODAY, 2) };
  const create = (date: string, startTime = '20:00') => asManager(tx => createEvent(tx, { ...eventInput, date, startTime, eventTypeId: typeId }));
  const past = await create(dates.past);
  const started = await create(dates.started, '00:00');
  const future = await create(dates.future);
  const later = await create(dates.later);
  const [hall] = await testSql<{ id: string }[]>`select id from position where name='ЗАЛ'`;
  const [worker] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key) values ('Анна Ставки','анна ставки') returning id`;
  for (const eventId of [past, started, future, later]) {
    await testSql`insert into assignment(worker_id,event_id,position_id) values (${worker.id},${eventId},${hall.id})`;
  }
  return { typeId, dates, past, started, future, later, hall: hall.id, worker: worker.id };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const months = (s: Setup) => [...new Set(Object.values(s.dates).map(d => d.slice(0, 7)))].sort();
/** Суммы смен по порядку дат — расчётом «Оплаты» за все месяцы мероприятий. */
async function amounts(s: Setup): Promise<Array<number | null>> {
  const result: Array<number | null> = [];
  for (const month of months(s)) result.push(...(await asManager(tx => payForMonth(tx, month))).details.map(x => x.amount));
  return result;
}
const importRow = (date: string, eventTypeName?: string) => ({
  date, startTime: '20:00', arriveTime: null, concert: null, tag: 'regular' as const,
  ...(eventTypeName ? { eventTypeName } : {}), baseRate: null, rawRate: null, comment: null, staff: [],
});

it('ставка вида попадает во все новые мероприятия, и задним числом (M2), и в расчёт менеджера и работника', async () => {
  const s = await setup();
  const settings = await asManager(tx => getEventTypeSettings(tx, s.typeId));
  expect(settings.slots.find(p => p.positionName === 'ЗАЛ')?.rate).toBe(2000);
  expect(await amounts(s)).toEqual([2000, 2000, 2000, 2000]);
  let earned = 0;
  const shifts: Array<number | null> = [];
  for (const month of months(s)) {
    earned += (await asWorker(s.worker, tx => myEarnings(tx, s.worker, month))).total;
    shifts.push(...(await asWorker(s.worker, tx => monthShifts(tx, s.worker, month))).map(x => x.amount));
  }
  expect(earned).toBe(8000);
  expect(shifts).toEqual([2000, 2000, 2000, 2000]);
});

it('мероприятие, созданное давно прошедшей датой, получает ставку вида (M2)', async () => {
  const s = await setup();
  const old = await asManager(tx => createEvent(tx, { ...eventInput, date: '2020-01-01', eventTypeId: s.typeId }));
  expect((await asManager(tx => getEventCard(tx, old)))?.slots.find(x => x.name === 'ЗАЛ')).toMatchObject({ quantity: 1, typeRate: 2000 });
});

it('импорт нового прошедшего мероприятия получает ставку вида (M2)', async () => {
  await setup();
  await asManager(tx => applyImport(tx, [importRow('2020-02-01', 'Седер тест')]));
  const [slot] = await testSql`select s.type_rate from event_slot s join event e on e.id = s.event_id
    join position p on p.id = s.position_id where e.event_date = '2020-02-01' and p.name = 'ЗАЛ'`;
  expect(slot.type_rate).toBe(2000);
});

it('триггер не перезаписывает заданный снимок ставки вида (M2)', async () => {
  const s = await setup();
  const [balcony] = await testSql<{ id: string }[]>`select id from position where name='БАЛКОН'`;
  await asManager(tx => tx`update event_type_slot set rate=1500 where event_type_id=${s.typeId} and position_id=${balcony.id}`);
  await asManager(tx => tx`insert into event_slot(event_id,position_id,quantity,type_rate) values (${s.future},${balcony.id},1,999)`);
  expect(await testSql`select type_rate from event_slot where event_id=${s.future} and position_id=${balcony.id}`).toEqual([{ type_rate: 999 }]);
});

it('правка ставки вида меняет ещё не начавшиеся мероприятия; прошлые, уже начавшиеся сегодня (L1) и ручные исключения — нет', async () => {
  const s = await setup();
  await asManager(tx => setSlot(tx, { eventId: s.later, positionId: s.hall, quantity: 1, rate: 2600 }));
  const assignments = await testSql`select * from assignment order by id`;
  await asManager(tx => save(tx, s.typeId, 2300));
  expect(await amounts(s)).toEqual([2000, 2000, 2300, 2600]);
  expect(await testSql`select * from assignment order by id`).toEqual(assignments);
  // Пустое поле снимает исключение и возвращает актуальную ставку вида.
  await asManager(tx => setSlot(tx, { eventId: s.later, positionId: s.hall, quantity: 1, rate: null }));
  expect(await amounts(s)).toEqual([2000, 2000, 2300, 2300]);
});

it('личная ставка и явный ноль имеют приоритет, очистка ставки вида возвращает общий расчёт', async () => {
  const s = await setup();
  await testSql`update assignment set rate=2800 where event_id=${s.future}`;
  await asManager(tx => setSlot(tx, { eventId: s.later, positionId: s.hall, quantity: 1, rate: 0 }));
  await asManager(tx => save(tx, s.typeId, null));
  expect(await amounts(s)).toEqual([2000, 2000, 2800, 0]);
  await asManager(tx => setSlot(tx, { eventId: s.later, positionId: s.hall, quantity: 1, rate: null }));
  expect(await amounts(s)).toEqual([2000, 2000, 2800, 1300]);
});

it('новая должность при применении состава получает ставку вида', async () => {
  const s = await setup();
  const slots = (await asManager(tx => slotsFor(tx, { 'ЗАЛ': 1, 'БИЛЕТЫ': 1, 'БАЛКОН': 1 }))).map(x => ({ ...x, rate: 1500 }));
  await asManager(tx => saveEventType(tx, { id: s.typeId, name: 'Седер тест', slots }));
  await asManager(tx => applyEventTemplate(tx, s.future, TODAY));
  const card = await asManager(tx => getEventCard(tx, s.future));
  expect(card?.slots.find(x => x.name === 'БАЛКОН')).toMatchObject({ quantity: 1, typeRate: 1500, rate: null });
});

it.each(['мероприятия', 'вида'])('применение состава %s сохраняет оплату уже начавшегося мероприятия при добавлении места', async mode => {
  const s = await setup();
  const [balcony] = await testSql<{ id: string }[]>`select id from position where name='БАЛКОН'`;
  // Старое назначение из импорта: человек на должности, но строки места ещё нет.
  expect(await testSql`select 1 from event_slot where event_id=${s.started} and position_id=${balcony.id}`).toEqual([]);
  await testSql`update assignment set position_id=${balcony.id} where event_id=${s.started}`;
  await asManager(tx => setSlot(tx, { eventId: s.started, positionId: s.hall, quantity: 2, rate: 2600 }));
  const slots = (await asManager(tx => slotsFor(tx, { 'ЗАЛ': 3, 'БИЛЕТЫ': 1, 'БАЛКОН': 1 })))
    .map(x => ({ ...x, rate: 2500 }));
  await asManager(tx => saveEventType(tx, { id: s.typeId, name: 'Седер тест', slots }));
  expect(await amounts(s)).toEqual([2000, 1300, 2500, 2500]);
  const assignments = await testSql`select * from assignment order by id`;

  await asManager(tx => mode === 'мероприятия'
    ? applyEventTemplate(tx, s.started, TODAY)
    : applyTypeTemplate(tx, s.typeId, TODAY));

  const card = await asManager(tx => getEventCard(tx, s.started));
  expect(card?.slots.find(x => x.name === 'БАЛКОН')).toMatchObject({ quantity: 1, typeRate: null, rate: null });
  expect(card?.slots.find(x => x.name === 'ЗАЛ')).toMatchObject({ quantity: 3, typeRate: 2000, rate: 2600 });
  expect(await amounts(s)).toEqual([2000, 1300, 2500, 2500]);
  expect((await asWorker(s.worker, tx => monthShifts(tx, s.worker, TODAY.slice(0, 7))))
    .find(x => x.date === TODAY)?.amount).toBe(1300);
  expect(await testSql`select * from assignment order by id`).toEqual(assignments);
});

it('смена вида не начавшегося мероприятия меняет наследуемую ставку и сохраняет исключение; начавшегося — нет', async () => {
  const s = await setup();
  const otherSlots = (await asManager(tx => slotsFor(tx, { 'ЗАЛ': 1 }))).map(x => ({ ...x, rate: 1700 }));
  const other = await asManager(tx => saveEventType(tx, { id: null, name: 'Другой вид', slots: otherSlots }));
  await asManager(tx => setSlot(tx, { eventId: s.later, positionId: s.hall, quantity: 1, rate: 2600 }));
  await asManager(tx => updateEvent(tx, s.started, { ...eventInput, date: s.dates.started, startTime: '00:00', eventTypeId: other }));
  await asManager(tx => updateEvent(tx, s.future, { ...eventInput, date: s.dates.future, eventTypeId: other }));
  await asManager(tx => updateEvent(tx, s.later, { ...eventInput, date: s.dates.later, eventTypeId: other }));
  expect(await amounts(s)).toEqual([2000, 2000, 1700, 2600]);
});

it('работник и аноним не меняют ставки шаблонов и мероприятий', async () => {
  const s = await setup();
  for (const run of [(fn: (tx: Tx) => Promise<void>) => asWorker(s.worker, fn), asAppAnon]) {
    await expect(run(async tx => { await save(tx, s.typeId, 1); })).rejects.toThrow();
  }
  expect(await amounts(s)).toEqual([2000, 2000, 2000, 2000]);
});

it('сохранение старой формы без ставок не стирает ставки вида и мероприятий', async () => {
  const s = await setup();
  await asManager(async tx => saveEventType(tx, { id: s.typeId, name: 'Седер тест', slots: await slotsFor(tx, { 'ЗАЛ': 1, 'БИЛЕТЫ': 1 }) }));
  expect((await asManager(tx => getEventTypeSettings(tx, s.typeId))).slots.find(x => x.positionName === 'ЗАЛ')?.rate).toBe(2000);
  expect(await amounts(s)).toEqual([2000, 2000, 2000, 2000]);
});

it('импорт нового вида у не начавшегося мероприятия обновляет ставку, сохраняя ручное исключение; начавшееся — нет', async () => {
  const s = await setup();
  const otherSlots = (await asManager(tx => slotsFor(tx, { 'ЗАЛ': 1 }))).map(x => ({ ...x, rate: 1700 }));
  await asManager(tx => saveEventType(tx, { id: null, name: 'Другой седер', slots: otherSlots }));
  await asManager(tx => setSlot(tx, { eventId: s.later, positionId: s.hall, quantity: 1, rate: 2600 }));
  await asManager(tx => applyImport(tx, [
    { ...importRow(s.dates.started, 'Другой седер'), startTime: '00:00' },
    importRow(s.dates.future, 'Другой седер'), importRow(s.dates.later, 'Другой седер'),
  ]));
  expect(await amounts(s)).toEqual([2000, 2000, 1700, 2600]);
});

it('показывает ставку вида для отсутствующей должности только у не начавшегося мероприятия', async () => {
  const s = await setup();
  expect((await asManager(tx => getEventCard(tx, s.future)))?.slots.find(x => x.name === 'БАЛКОН'))
    .toMatchObject({ quantity: 0, typeRate: 2000, rate: null });
  expect((await asManager(tx => getEventCard(tx, s.started)))?.slots.find(x => x.name === 'БАЛКОН')?.typeRate).toBe(null);
});

it('место на прошедшем или уже начавшемся мероприятии — без нынешней ставки вида, на будущем — с ней', async () => {
  const s = await setup();
  const old = await asManager(tx => createEvent(tx, { ...eventInput, date: '2020-01-01', eventTypeId: s.typeId }));
  const [balcony] = await testSql<{ id: string }[]>`select id from position where name='БАЛКОН'`;
  await testSql`insert into assignment(worker_id,event_id,position_id) values (${s.worker},${old},${balcony.id})`;
  expect((await asManager(tx => getEventCard(tx, old)))?.slots.find(x => x.name === 'БАЛКОН')?.typeRate).toBe(null);
  await asManager(tx => setSlot(tx, { eventId: old, positionId: balcony.id, quantity: 1, rate: null }));
  expect((await asManager(tx => payForMonth(tx, '2020-01'))).details[0].amount).toBe(1300);
  for (const [eventId, expected] of [[s.started, null], [s.future, 2000]] as const) {
    await asManager(tx => setSlot(tx, { eventId, positionId: balcony.id, quantity: 1, rate: null }));
    expect(await testSql`select type_rate from event_slot where event_id=${eventId} and position_id=${balcony.id}`)
      .toEqual([{ type_rate: expected }]);
  }
  // Повторное сохранение существующего места не стирает его снимок.
  await asManager(tx => setSlot(tx, { eventId: s.past, positionId: s.hall, quantity: 2, rate: null }));
  expect(await testSql`select type_rate from event_slot where event_id=${s.past} and position_id=${s.hall}`).toEqual([{ type_rate: 2000 }]);
});

it('повторно проверяет вид перед созданием отсутствующего места после ожидания блокировки', async () => {
  const s = await setup();
  const otherSlots = (await asManager(tx => slotsFor(tx, { 'ЗАЛ': 1 }))).map(x => ({ ...x, rate: 1700 }));
  const other = await asManager(tx => saveEventType(tx, { id: null, name: 'Другой седер', slots: otherSlots }));
  const [balcony] = await testSql<{ id: string }[]>`select id from position where name='БАЛКОН'`;
  let entered!: () => void; let release!: () => void; let secondEntered!: (pid: number) => void;
  const ready = new Promise<void>(r => { entered = r; });
  const barrier = new Promise<void>(r => { release = r; });
  const secondReady = new Promise<number>(r => { secondEntered = r; });
  const first = asManager(async tx => {
    await tx`select id from event_type where id=${s.typeId} for update`;
    entered(); await barrier;
  });
  await ready;
  const second = asManager(async tx => {
    const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`; secondEntered(row.pid);
    return setSlot(tx, { eventId: s.future, positionId: balcony.id, quantity: 1, rate: null });
  });
  const rejected = expect(second).rejects.toThrow(/изменил|обновите/);
  void rejected.catch(() => {});
  try {
    const pid = await secondReady;
    await expect.poll(async () => {
      const [row] = await testSql<{ waiting: boolean }[]>`select cardinality(pg_blocking_pids(${pid}))>0 as waiting`;
      return row.waiting;
    }, { timeout: 3000 }).toBe(true);
    await asManager(tx => updateEvent(tx, s.future, { ...eventInput, date: s.dates.future, eventTypeId: other }));
  } finally { release(); }
  await first; await rejected;
  expect(await testSql`select position_id from event_slot where event_id=${s.future} and position_id=${balcony.id}`).toHaveLength(0);
});

it.each(['правка', 'импорт'])('одновременные %s мероприятия и ставка вида не блокируют друг друга навсегда', async mode => {
  const s = await setup();
  let entered!: () => void;
  let release!: () => void;
  let secondEntered!: (pid: number) => void;
  const ready = new Promise<void>(r => { entered = r; });
  const barrier = new Promise<void>(r => { release = r; });
  const secondReady = new Promise<number>(r => { secondEntered = r; });
  const first = asManager(async tx => {
    await tx`select id from event_type where id=${s.typeId} for update`;
    entered();
    await barrier;
    await save(tx, s.typeId, 2300);
  });
  await ready;
  const second = asManager(async tx => {
    const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    secondEntered(row.pid);
    if (mode === 'правка') await updateEvent(tx, s.future, { ...eventInput, date: s.dates.future, eventTypeId: s.typeId });
    else await applyImport(tx, [importRow(s.dates.future)]);
  });
  const completed = Promise.all([first, second]);
  void completed.catch(() => {});
  try {
    const pid = await secondReady;
    await expect.poll(async () => {
      const [row] = await testSql<{ waiting: boolean }[]>`select cardinality(pg_blocking_pids(${pid}))>0 as waiting`;
      return row.waiting;
    }, { timeout: 3000 }).toBe(true);
  } finally { release(); }
  await completed;
  expect(await amounts(s)).toEqual([2000, 2000, 2300, 2300]);
});

it('правка мероприятия не взаимно блокируется с новым назначением на его место', async () => {
  const s = await setup();
  const [worker] = await testSql<{ id: string }[]>`insert into worker(full_name,name_key) values ('Борис Ставки','борис ставки') returning id`;
  await asManager(tx => setSlot(tx, { eventId: s.future, positionId: s.hall, quantity: 2, rate: null }));
  let entered!: () => void; let release!: () => void; let secondEntered!: (pid: number) => void;
  const ready = new Promise<void>(r => { entered = r; });
  const barrier = new Promise<void>(r => { release = r; });
  const secondReady = new Promise<number>(r => { secondEntered = r; });
  const first = asManager(async tx => {
    await tx`select id from event where id=${s.future} for update`;
    entered(); await barrier;
    await updateEvent(tx, s.future, { ...eventInput, date: s.dates.future, eventTypeId: s.typeId });
  });
  await ready;
  const second = asManager(async tx => {
    const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`; secondEntered(row.pid);
    await assignWorker(tx, { eventId: s.future, workerId: worker.id, positionId: s.hall });
  });
  const completed = Promise.all([first, second]); void completed.catch(() => {});
  try {
    const pid = await secondReady;
    await expect.poll(async () => {
      const [row] = await testSql<{ waiting: boolean }[]>`select cardinality(pg_blocking_pids(${pid}))>0 as waiting`;
      return row.waiting;
    }, { timeout: 3000 }).toBe(true);
  } finally { release(); }
  await completed;
  expect(await testSql`select id from assignment where event_id=${s.future}`).toHaveLength(2);
});
