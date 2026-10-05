import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { ev } from './scheduleFixtures';
import { createDraftMonth } from '@/lib/monthPlan/months';
import { getMonthPlan, placePeople, setPlanCell } from '@/lib/monthPlan/plan';

let first: string; let second: string; let tickets: string; let hall: string;
let ian: string; let andrey: string;

beforeEach(async () => {
  await resetTestDb();
  await asManager((tx) => createDraftMonth(tx, '2099-07', [
    ev('2099-07-04', '19:30', 'Голос Диснея'),
    ev('2099-07-03', '20:00', 'Лунный свет'),
  ]));
  const events = await testSql`select id from event order by event_date`;
  first = events[0].id; second = events[1].id;
  [{ id: tickets }] = await testSql`select id from position where name = 'БИЛЕТЫ'`;
  [{ id: hall }] = await testSql`select id from position where name = 'ЗАЛ'`;
  [{ id: ian }] = await testSql`insert into worker (full_name, name_key) values ('Ян Образцовый', 'образцовый ян') returning id`;
  [{ id: andrey }] = await testSql`insert into worker (full_name, name_key) values ('Андрей Макетный', 'андрей макетный') returning id`;
});

const cell = (eventId: string, positionId: string, row: number, previousWorkerId: string | null, workerId: string | null) =>
  asManager((tx) => setPlanCell(tx, { eventId, positionId, row, previousWorkerId, workerId }));

describe('placePeople', () => {
  const p = (id: string, planRow: number | null) => ({ workerId: id, fullName: id, planRow });
  it('номер строки — на месте, без номера — в первые свободные, лишние — в конец', () => {
    expect(placePeople([p('a', 2), p('b', null), p('c', 2), p('d', null)], 3).map((x) => x?.workerId ?? null))
      .toEqual(['b', 'c', 'a', 'd']);
    expect(placePeople([], 2)).toEqual([null, null]);
  });
});

describe('getMonthPlan', () => {
  it('нет месяца — null', async () => {
    expect(await asManager((tx) => getMonthPlan(tx, '2099-09'))).toBeNull();
  });

  it('столбцы по дате, строки должностей по максимуму мест, люди по строкам', async () => {
    await cell(first, tickets, 2, null, ian);
    const plan = await asManager((tx) => getMonthPlan(tx, '2099-07'));
    expect(plan?.status).toBe('draft');
    expect(plan?.columns.map((c) => [c.date, c.startTime, c.concert, c.arriveTime, c.arriveManual]))
      .toEqual([['2099-07-03', '20:00', 'Лунный свет', '18:00', false], ['2099-07-04', '19:30', 'Голос Диснея', '17:30', false]]);
    expect(plan?.positions.map((p) => [p.name, p.rows])).toEqual([
      ['АДМИН', 1], ['ЗАЛ', 1], ['ВХОД В ЗАЛ', 1], ['БИЛЕТЫ', 3], ['БАЛКОН', 1], ['ВХОД', 1], ['КАССА', 1],
    ]);
    expect(plan?.people[first][tickets]).toEqual([null, null, { workerId: ian, fullName: 'Ян Образцовый' }]);
    expect(plan?.workers.map((w) => w.fullName)).toEqual(['Андрей Макетный', 'Ян Образцовый']);
  });

  it('заявки и люди без должности', async () => {
    await testSql`update month set status = 'published'`;
    await testSql`insert into signup (worker_id, event_id) values (${andrey}, ${second})`;
    await testSql`insert into assignment (worker_id, event_id) values (${ian}, ${second})`;
    const plan = await asManager((tx) => getMonthPlan(tx, '2099-07'));
    expect(plan?.signups).toEqual({ [second]: [andrey] });
    expect(plan?.unplaced).toEqual({ [second]: [ian] });
  });
});

describe('setPlanCell', () => {
  const at = async () => (await testSql`
    select worker_id, position_id, plan_row from assignment order by created_at`).map((r) =>
    [r.worker_id, r.position_id, r.plan_row]);

  it('вписать, заменить, очистить', async () => {
    await cell(first, tickets, 1, null, ian);
    expect(await at()).toEqual([[ian, tickets, 1]]);
    await cell(first, tickets, 1, ian, andrey);
    expect(await at()).toEqual([[andrey, tickets, 1]]);
    await cell(first, tickets, 1, andrey, null);
    expect(await at()).toEqual([]);
  });

  it('человек уже на мероприятии — нельзя, с указанием должности', async () => {
    await cell(first, hall, 0, null, ian);
    await expect(cell(first, tickets, 0, null, ian)).rejects.toThrow('Уже на этом мероприятии: ЗАЛ');
    await testSql`insert into assignment (worker_id, event_id) values (${andrey}, ${first})`;
    await expect(cell(first, tickets, 0, null, andrey)).rejects.toThrow('Уже на этом мероприятии: без должности');
  });

  it('разные мероприятия одного человека — можно', async () => {
    await cell(first, hall, 0, null, ian);
    await cell(second, hall, 0, null, ian);
    expect(await at()).toHaveLength(2);
  });

  it('заявка принимается, когда человека вписали', async () => {
    await testSql`insert into signup (worker_id, event_id) values (${andrey}, ${first})`;
    await cell(first, tickets, 0, null, andrey);
    const [s] = await testSql`select status::text as status from signup`;
    expect(s.status).toBe('accepted');
  });

  it('сверх мест и кривой номер строки — ошибка', async () => {
    await cell(first, hall, 0, null, ian);
    await expect(cell(first, hall, 1, null, andrey)).rejects.toThrow(/мест нет/);
    await expect(cell(first, hall, -1, null, andrey)).rejects.toThrow('Некорректная строка таблицы');
    await expect(cell(first, hall, 1.5, null, andrey)).rejects.toThrow('Некорректная строка таблицы');
  });

  it('устаревшая ячейка: прежний человек уже на другой должности — ошибка, ничего не меняется', async () => {
    await testSql`update month set status = 'published'`;
    await testSql`insert into signup (worker_id, event_id) values (${ian}, ${first})`;
    await cell(first, hall, 0, null, ian);
    await expect(cell(first, tickets, 0, ian, andrey)).rejects.toThrow('Ячейка изменилась — обновите страницу');
    await expect(cell(first, tickets, 0, ian, null)).rejects.toThrow('Ячейка изменилась — обновите страницу');
    expect(await at()).toEqual([[ian, hall, 0]]);
    const signups = await testSql`select worker_id, status::text as status from signup`;
    expect(signups.map((s) => [s.worker_id, s.status])).toEqual([[ian, 'accepted']]);
  });

  it('тот же человек в ту же ячейку — ничего не меняется', async () => {
    await cell(first, tickets, 0, null, ian);
    await cell(first, tickets, 0, ian, ian);
    expect(await at()).toEqual([[ian, tickets, 0]]);
  });
});
