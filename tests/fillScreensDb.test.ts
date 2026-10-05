import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asWorker, asManager } from './setup';
import { earningsOverview, myEarnings } from '@/app/(worker)/queries';
import { workerStats } from '@/app/(manager)/workers/operations';

let ilya: string; let artem: string; let hall: string;

beforeEach(async () => {
  await resetTestDb();
  [{ id: ilya }] = await testSql`insert into worker (full_name, name_key) values ('Илья', 'илья') returning id`;
  [{ id: artem }] = await testSql`insert into worker (full_name, name_key) values ('Артем', 'артем') returning id`;
  [{ id: hall }] = await testSql`select id from position where name = 'ЗАЛ'`;
});

async function shift(workerId: string, date: string, rate: number | null) {
  const [e] = await testSql`insert into event (event_date, start_time, base_rate, concert)
    values (${date}, '19:00', ${rate}, ${`Концерт ${date}`}) returning id`;
  await testSql`insert into assignment (worker_id, event_id, position_id) values (${workerId}, ${e.id}, ${hall})`;
}

describe('earningsOverview — заработок месяца и столбики одним запросом', () => {
  it('выбранный месяц — как myEarnings, столбики — по окну', async () => {
    await shift(ilya, '2030-03-05', 1300);
    await shift(ilya, '2030-03-20', null);
    await shift(ilya, '2030-05-02', 2000);
    await shift(ilya, '2029-12-31', 5000); // до окна
    await shift(artem, '2030-03-06', 9999); // чужая

    const overview = await asWorker(ilya, (tx) => earningsOverview(tx, ilya, '2030-03', { from: '2029-12', to: '2030-05' }));
    expect(overview.selected).toEqual(await asWorker(ilya, (tx) => myEarnings(tx, ilya, '2030-03')));
    expect(overview.selected).toMatchObject({ shifts: 2, total: 1300, unpriced: 1 });
    expect(overview.bars).toEqual([
      { month: '2029-12', total: 5000, shifts: 1, unpriced: 0 },
      { month: '2030-01', total: 0, shifts: 0, unpriced: 0 },
      { month: '2030-02', total: 0, shifts: 0, unpriced: 0 },
      { month: '2030-03', total: 1300, shifts: 2, unpriced: 1 },
      { month: '2030-04', total: 0, shifts: 0, unpriced: 0 },
      { month: '2030-05', total: 2000, shifts: 1, unpriced: 0 },
    ]);
  });

  it('черновой месяц работнику не виден — и в столбиках тоже', async () => {
    await testSql`insert into month (month, status) values ('2030-04', 'draft')`;
    await shift(ilya, '2030-04-10', 1300);
    const overview = await asWorker(ilya, (tx) => earningsOverview(tx, ilya, '2030-04', { from: '2030-04', to: '2030-04' }));
    expect(overview.bars).toEqual([{ month: '2030-04', total: 0, shifts: 0, unpriced: 0 }]);
    expect(overview.selected.items).toEqual([]);
  });

  it('чужой id под своей сессией — нули', async () => {
    await shift(artem, '2030-03-06', 1300);
    const overview = await asWorker(ilya, (tx) => earningsOverview(tx, artem, '2030-03', { from: '2030-03', to: '2030-03' }));
    expect(overview.bars).toEqual([{ month: '2030-03', total: 0, shifts: 0, unpriced: 0 }]);
    expect(overview.selected).toEqual({ shifts: 0, total: 0, unpriced: 0, items: [] });
  });
});

describe('workerStats — показатели «Работников»', () => {
  it('работают, в архиве; Telegram и календарь — только у работающих', async () => {
    const [arch] = await testSql`insert into worker (full_name, name_key, status) values ('Архивный', 'архивный', 'archived') returning id`;
    await testSql`insert into telegram_link (worker_id, chat_id) values (${ilya}, 101), (${arch.id}, 102), (null, 103)`;
    await testSql`insert into calendar_feed (worker_id, token_hash) values (${artem}, 'a'), (${arch.id}, 'b'), (null, 'm')`;
    expect(await asManager((tx) => workerStats(tx))).toEqual({ active: 2, archived: 1, telegram: 1, calendar: 1 });
  });

  it('пустая база — нули', async () => {
    await testSql`delete from worker`;
    expect(await asManager((tx) => workerStats(tx))).toEqual({ active: 0, archived: 0, telegram: 0, calendar: 0 });
  });

  it('работник под своей сессией видит только себя', async () => {
    await testSql`insert into telegram_link (worker_id, chat_id) values (${artem}, 201)`;
    const stats = await asWorker(ilya, (tx) => workerStats(tx));
    expect(stats.telegram).toBe(0);
    expect(stats.active).toBeLessThanOrEqual(1);
  });
});
