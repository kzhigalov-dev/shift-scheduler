import { beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resetTestDb, testSql, asManager, asWorker, asAppAnon } from './setup';

const migrate = () => testSql.unsafe(readFileSync(path.resolve(__dirname,
  '../supabase/migrations/0009_event_types.sql'), 'utf8'));
beforeEach(() => resetTestDb('0008'));

it('переносит вид без изменения мест, назначений, времени и ставок', async () => {
  const [hall] = await testSql`select id from position where name = 'ЗАЛ'`;
  await testSql`update position set default_quantity = 2 where id = ${hall.id}`;
  const [worker] = await testSql`insert into worker (full_name, name_key)
    values ('Алиса Выдумкина', 'алиса выдумкина') returning id`;
  const [event] = await testSql`insert into event (event_date, start_time, arrive_time, tag, base_rate)
    values ('2099-10-01', '20:00', '19:13', 'night', 1800) returning id`;
  await testSql`insert into event_slot (event_id, position_id, quantity, rate)
    values (${event.id}, ${hall.id}, 4, 2100)`;
  await testSql`insert into assignment (event_id, worker_id, position_id, rate)
    values (${event.id}, ${worker.id}, ${hall.id}, 2500)`;
  const slots = await testSql`select * from event_slot`;
  const people = await testSql`select * from assignment`;
  const telegram = await testSql`select * from tg_event`;
  await migrate();
  expect(await testSql`select * from event_slot`).toEqual(slots);
  expect(await testSql`select * from assignment`).toEqual(people);
  expect(await testSql`select * from tg_event`).toEqual(telegram);
  const [linked] = await testSql`select t.system_tag, e.arrive_time::text, e.base_rate from event e
    join event_type t on t.id = e.event_type_id where e.id = ${event.id}`;
  expect(linked).toEqual({system_tag:'night', arrive_time:'19:13:00', base_rate:1800});
  const templates = await testSql`select quantity from event_type_slot where position_id = ${hall.id}`;
  expect(templates).toHaveLength(6);
  expect(templates.every((s) => s.quantity === 2)).toBe(true);
});

it('сохраняет старые вставки и синхронизирует техническую классификацию', async () => {
  await migrate();
  const [e] = await asManager(tx => tx`insert into event (event_date, start_time, tag)
    values ('2099-10-02', '22:00', 'night') returning id, event_type_id`);
  const [night] = await testSql`select id from event_type where system_tag='night'`;
  expect(e.event_type_id).toBe(night.id);
  const [custom] = await asManager(tx => tx`insert into event_type(name,sort_order)
    values ('Новый',7) returning id`);
  const [changed] = await asManager(tx => tx`update event set event_type_id=${custom.id}
    where id=${e.id} returning tag`);
  expect(changed.tag).toBe('regular');
  const [back] = await asManager(tx => tx`update event set tag='organ' where id=${e.id}
    returning event_type_id`);
  const [organ] = await testSql`select id from event_type where system_tag='organ'`;
  expect(back.event_type_id).toBe(organ.id);
});

it('закрывает шаблоны работнику, справочник анониму и системный тег менеджеру', async () => {
  await migrate();
  const [w] = await testSql`insert into worker(full_name,name_key) values ('Борис','борис') returning id`;
  expect(await asWorker(w.id,tx=>tx`select id from event_type`)).toHaveLength(6);
  expect(await asWorker(w.id,tx=>tx`select * from event_type_slot`)).toHaveLength(0);
  expect(await asAppAnon(tx=>tx`select id from event_type`)).toHaveLength(0);
  expect(await asAppAnon(tx=>tx`select * from event_type_slot`)).toHaveLength(0);
  expect(await asWorker(w.id,tx=>tx`update event_type set name='Чужое' returning id`)).toHaveLength(0);
  await expect(asManager(tx=>tx`update event_type set system_tag=null`)).rejects.toThrow(/permission denied/);
  await expect(asManager(tx=>tx`delete from event_type`)).rejects.toThrow(/permission denied/);
  await expect(asManager(tx=>tx`insert into event_type(name,sort_order) values ('  ОбыЧНОЕ  ',8)`)).rejects.toThrow(/duplicate key/);
});
