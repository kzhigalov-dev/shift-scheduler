import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { payForMonth } from '@/app/(manager)/pay/queries';

beforeEach(async () => {
  await resetTestDb();
  const [hall] = await testSql`select id from position where name = 'ЗАЛ'`;
  const [cash] = await testSql`select id from position where name = 'КАССА'`;
  await testSql`update position set default_rate = 1500 where id = ${cash.id}`;

  const [ilya] = await testSql`insert into worker (full_name, name_key) values ('Илья', 'илья') returning id`;
  const [polina] = await testSql`insert into worker (full_name, name_key) values ('Полина', 'полина') returning id`;
  const [artem] = await testSql`insert into worker (full_name, name_key) values ('Артем', 'артем') returning id`;

  const [e1] = await testSql`insert into event (event_date, start_time, base_rate, concert)
    values ('2026-07-09', '20:00', 1300, 'Лунный свет') returning id`;
  const [e2] = await testSql`insert into event (event_date, start_time, base_rate)
    values ('2026-07-10', '20:00', 1300) returning id`;
  const [e3] = await testSql`insert into event (event_date, start_time, base_rate)
    values ('2026-08-01', '20:00', 1300) returning id`;
  const [e4] = await testSql`insert into event (event_date, start_time)
    values ('2026-07-11', '20:00') returning id`;

  // На e2 касса получает 1800 — ставка должности на концерте.
  await testSql`insert into event_slot (event_id, position_id, quantity, rate)
    values (${e2.id}, ${cash.id}, 1, 1800)`;

  await testSql`insert into assignment (worker_id, event_id, position_id, rate) values
    (${ilya.id},   ${e1.id}, ${hall.id}, null),   -- ставка концерта 1300
    (${ilya.id},   ${e2.id}, ${hall.id}, 2400),   -- личная 2400
    (${ilya.id},   ${e3.id}, ${hall.id}, null),   -- август, не считается
    (${polina.id}, ${e1.id}, ${cash.id}, null),   -- касса по умолчанию 1500
    (${polina.id}, ${e2.id}, ${cash.id}, null),   -- касса на концерте 1800
    (${artem.id},  ${e4.id}, null, null)          -- ставки нет нигде`;
});

describe('payForMonth', () => {
  it('выбирает ставку по уровням и считает только месяц', async () => {
    const { rows } = await asManager((tx) => payForMonth(tx, '2026-07'));
    expect(rows).toEqual([
      expect.objectContaining({ fullName: 'Илья', shifts: 2, total: 3700, unpriced: 0 }),
      expect.objectContaining({ fullName: 'Полина', shifts: 2, total: 3300, unpriced: 0 }),
      expect.objectContaining({ fullName: 'Артем', shifts: 1, total: 0, unpriced: 1 }),
    ]);
  });

  it('детализация по сменам в порядке дат', async () => {
    const { details } = await asManager((tx) => payForMonth(tx, '2026-07'));
    expect(details.map((d) => [d.date, d.fullName, d.position, d.amount])).toEqual([
      ['2026-07-09', 'Илья', 'ЗАЛ', 1300],
      ['2026-07-09', 'Полина', 'КАССА', 1500],
      ['2026-07-10', 'Илья', 'ЗАЛ', 2400],
      ['2026-07-10', 'Полина', 'КАССА', 1800],
      ['2026-07-11', 'Артем', null, null],
    ]);
  });

  it('пустой месяц', async () => {
    expect(await asManager((tx) => payForMonth(tx, '2026-02'))).toEqual({ rows: [], details: [] });
  });
});
