import { describe, it, expect, beforeAll } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { monthEvents } from '@/app/(manager)/month/queries';

beforeAll(async () => {
  await resetTestDb();
  const [e] = await testSql`insert into event (event_date, start_time, base_rate, concert)
    values ('2026-07-09', '20:00', 1300, 'Лунный свет') returning id`;
  await testSql`insert into event (event_date, start_time) values ('2026-08-01', '20:00')`;
  const [tickets] = await testSql`select id from position where name = 'БИЛЕТЫ'`;
  await testSql`insert into event_slot (event_id, position_id, quantity)
    values (${e.id}, ${tickets.id}, 3)`;
  const [a] = await testSql`insert into worker (full_name, name_key) values ('А', 'а') returning id`;
  const [b] = await testSql`insert into worker (full_name, name_key) values ('Б', 'б') returning id`;
  const [c] = await testSql`insert into worker (full_name, name_key) values ('В', 'в') returning id`;
  await testSql`insert into assignment (worker_id, event_id, position_id, cancel_requested_at)
    values (${a.id}, ${e.id}, ${tickets.id}, now())`;
  await testSql`insert into assignment (worker_id, event_id) values (${b.id}, ${e.id})`;
  await testSql`insert into signup (worker_id, event_id) values (${c.id}, ${e.id})`;
});

describe('monthEvents', () => {
  it('возвращает только события месяца со счётчиками', async () => {
    expect(await asManager((tx) => monthEvents(tx, '2026-07'))).toEqual([
      expect.objectContaining({
        date: '2026-07-09', startTime: '20:00', concert: 'Лунный свет', baseRate: 1300,
        needed: 3, filled: 2, unplaced: 1, cancelRequests: 1, pendingSignups: 1,
      }),
    ]);
  });

  it('на пустой месяц — пустой список', async () => {
    expect(await asManager((tx) => monthEvents(tx, '2026-01'))).toEqual([]);
  });
});
