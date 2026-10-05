import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { resetTestDb, testSql, asManager, asWorker, asAppAnon } from './setup';

beforeEach(() => resetTestDb('0011'));
const migrate = () => testSql.unsafe(readFileSync(path.resolve(__dirname, '../supabase/migrations/0012_event_type_rates.sql'), 'utf8'));

it('миграция сохраняет прежние места, шаблоны, людей и расчёт, новые снимки пусты', async () => {
  const [hall] = await testSql`select id from position where name='ЗАЛ'`;
  const [worker] = await testSql`insert into worker(full_name,name_key) values ('Тест Миграции','тест миграции') returning id`;
  const [event] = await testSql`insert into event(event_date,start_time,base_rate) values ('2026-10-01','20:00',1300) returning id`;
  await testSql`insert into event_slot(event_id,position_id,quantity,rate) values (${event.id},${hall.id},2,2100)`;
  await testSql`insert into assignment(event_id,worker_id,position_id,rate) values (${event.id},${worker.id},${hall.id},2500)`;
  const slots = await testSql`select * from event_slot`;
  const templates = await testSql`select * from event_type_slot order by event_type_id,position_id`;
  const assignments = await testSql`select * from assignment`;
  await migrate();
  expect(await testSql`select event_id,position_id,quantity,rate from event_slot`).toEqual(slots);
  expect(await testSql`select event_type_id,position_id,quantity from event_type_slot order by event_type_id,position_id`).toEqual(templates);
  expect(await testSql`select * from assignment`).toEqual(assignments);
  expect(await testSql`select type_rate from event_slot`).toEqual([{type_rate:null}]);
  expect((await testSql`select rate from event_type_slot`).every(x => x.rate === null)).toBe(true);
});

it('старые вставки мест получают снимок ставки, ручные суммы сохраняются, доступ ограничен RLS', async () => {
  await migrate();
  const [hall] = await testSql`select id from position where name='ЗАЛ'`;
  const [worker] = await testSql`insert into worker(full_name,name_key) values ('Тест Доступа','тест доступа') returning id`;
  const [type] = await testSql`select id from event_type where system_tag='seder'`;
  await asManager(tx => tx`update event_type_slot set rate=2000 where event_type_id=${type.id} and position_id=${hall.id}`);
  const [event] = await asManager(tx => tx`insert into event(event_date,start_time,event_type_id) values ('2099-10-01','20:00',${type.id}) returning id`);
  await asManager(tx => tx`insert into event_slot(event_id,position_id,quantity,rate) values (${event.id},${hall.id},1,2300)`);
  expect(await asManager(tx => tx`select rate,type_rate from event_slot where event_id=${event.id}`)).toEqual([{rate:2300,type_rate:2000}]);
  await expect(asManager(tx => tx`update event_type_slot set rate=-1`)).rejects.toThrow(/check constraint/);
  await expect(asManager(tx => tx`update event_type_slot set rate=1000001`)).rejects.toThrow(/check constraint/);
  expect(await asWorker(worker.id,tx => tx`update event_type_slot set rate=1 returning position_id`)).toHaveLength(0);
  expect(await asAppAnon(tx => tx`update event_slot set type_rate=1 returning event_id`)).toHaveLength(0);
});
