import { beforeEach, expect, it } from 'vitest';
import { resetTestDb, testSql, asManager, asWorker } from './setup';
import { eventInput, slotsFor } from './eventTypeFixtures';
import { saveEventType } from '@/lib/eventTypes/operations';
import { createEvent } from '@/lib/events';
import { setSlot } from '@/app/(manager)/event/[id]/operations';
import { availableEvents } from '@/app/(worker)/queries';
import { processEvents } from '@/lib/telegram/process';

/** «Свободные» и бот показывают ставку, которую работник получит: с учётом ставок вида (L6). */
let worker: string;
let typeId: string;
beforeEach(async () => {
  await resetTestDb();
  [{ id: worker }] = await testSql`insert into worker (full_name, name_key) values ('Ян', 'ян') returning id`;
  typeId = await asManager(async (tx) => {
    const slots = (await slotsFor(tx, { 'ЗАЛ': 1, 'БИЛЕТЫ': 2 }))
      .map((s) => ({ ...s, rate: null }));
    return saveEventType(tx, { id: null, name: 'Седер ставки', slots });
  });
  await testSql`update event_type_slot t set rate = case p.name when 'ЗАЛ' then 2000 when 'БИЛЕТЫ' then 1500 end
    from position p where p.id = t.position_id and t.event_type_id = ${typeId}`;
});

it('«Свободные»: диапазон по местам с учётом ставки вида, без базовой ставки — не «уточняется»', async () => {
  const id = await asManager((tx) => createEvent(tx, { ...eventInput, date: '2099-07-10', baseRate: null, eventTypeId: typeId }));
  const [row] = await asWorker(worker, (tx) => availableEvents(tx, worker));
  expect(row).toMatchObject({ eventId: id, rate: { min: 1500, max: 2000 } });
});

it('ручная ставка места и базовая ставка мероприятия — тем же порядком, что оплата', async () => {
  const id = await asManager((tx) => createEvent(tx, { ...eventInput, date: '2099-07-10', baseRate: 1000, eventTypeId: typeId }));
  const [hall] = await testSql<{ id: string }[]>`select id from position where name = 'ЗАЛ'`;
  await asManager((tx) => setSlot(tx, { eventId: id, positionId: hall.id, quantity: 1, rate: 2600 }));
  expect((await asWorker(worker, (tx) => availableEvents(tx, worker)))[0].rate).toEqual({ min: 1500, max: 2600 });
  await testSql`update event_type_slot set rate = null`;
  await testSql`update event_slot set type_rate = null`;
  expect((await asWorker(worker, (tx) => availableEvents(tx, worker)))[0].rate).toEqual({ min: 1000, max: 2600 });
});

it('без мест — базовая ставка; без ставок вовсе — null', async () => {
  const plain = await asManager((tx) => createEvent(tx, { ...eventInput, date: '2099-07-10', baseRate: 1300, eventTypeId: typeId }));
  await testSql`delete from event_slot where event_id = ${plain}`;
  expect((await asWorker(worker, (tx) => availableEvents(tx, worker)))[0].rate).toEqual({ min: 1300, max: 1300 });
  await testSql`update event set base_rate = null`;
  expect((await asWorker(worker, (tx) => availableEvents(tx, worker)))[0].rate).toBeNull();
});

it('бот: «Нужен человек» со ставкой вида', async () => {
  await testSql`insert into telegram_link (worker_id, chat_id) values (${worker}, 101)`;
  await asManager((tx) => createEvent(tx, { ...eventInput, date: '2099-07-10', baseRate: null, eventTypeId: typeId }));
  await asManager((tx) => processEvents(tx, new Date('2099-07-08T09:00:00Z'), 'https://a.app'));
  const [row] = await testSql<{ text: string }[]>`select text from tg_outbox where chat_id = 101`;
  expect(row.text).toContain('💰 1 500–2 000 ₽');
});
