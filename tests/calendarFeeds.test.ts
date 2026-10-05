import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asWorker, asManager } from './setup';
import { managerFeed, workerFeed, workerShiftFile } from '@/lib/calendar/feeds';

const now = new Date(Date.UTC(2099, 6, 1, 9, 0));
const origin = 'https://a.app';
/** Строки .ics складываются по 75 октетов — перед проверкой содержимого разворачиваем. */
const unfold = (text: string) => text.replace(/\r\n /g, '');
let ian: string; let pub: string; let draft: string; let old: string; let tix: string;

beforeEach(async () => {
  await resetTestDb();
  [{ id: ian }] = await testSql`insert into worker (full_name, name_key) values ('Ян Образцовый', 'образцовый ян') returning id`;
  [{ id: tix }] = await testSql`select id from position where name = 'БИЛЕТЫ'`;
  await testSql`insert into month (month, status) values ('2099-08', 'draft')`;
  [{ id: pub }] = await testSql`insert into event (event_date, start_time, arrive_time, concert, base_rate)
    values ('2099-07-10', '20:00', '18:00', 'Лунный свет', 1300) returning id`;
  [{ id: draft }] = await testSql`insert into event (event_date, start_time, arrive_time, concert)
    values ('2099-08-05', '22:30', '21:00', 'Ночной орган') returning id`;
  [{ id: old }] = await testSql`insert into event (event_date, start_time, concert)
    values ('2099-03-01', '20:00', 'Давнее') returning id`;
  for (const e of [pub, draft, old]) {
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${e}, ${tix}, 2)`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${e}, ${tix})`;
  }
});

describe('лента работника', () => {
  it('только опубликованное и не старше 60 дней', async () => {
    const text = unfold(await asWorker(ian, (tx) => workerFeed(tx, ian, { now, origin })));
    expect(text).toContain(`UID:shift-${pub}-${ian}@annenkirche-shifts`);
    expect(text).not.toContain(draft);
    expect(text).not.toContain(old);
    expect(text).toContain('SUMMARY:Смена · БИЛЕТЫ · Лунный свет');
    expect(text).toContain('DTSTART:20990710T150000Z');
    expect(text).toContain('DTEND:20990710T183000Z');
    expect(text).toContain('Ставка: 1\u00a0300\u00a0₽');
    expect(text).toContain('https://a.app/shifts');
  });

  it('файл одной смены — только своей', async () => {
    const file = await asWorker(ian, (tx) => workerShiftFile(tx, ian, pub, { now, origin }));
    expect(file?.date).toBe('2099-07-10');
    expect(unfold(file?.body ?? '')).toContain('BEGIN:VEVENT');
    expect(await asWorker(ian, (tx) => workerShiftFile(tx, ian, draft, { now, origin }))).toBeNull();
  });

  it('файл смены — не чужой: опубликованная смена другого работника даёт null', async () => {
    const [{ id: other }] = await testSql`insert into worker (full_name, name_key) values ('Анна Учебная', 'учебная анна') returning id`;
    expect(await asWorker(other, (tx) => workerShiftFile(tx, other, pub, { now, origin }))).toBeNull();
  });
});

describe('приход после полуночи', () => {
  it('событие в 00:30 с приходом в 23:00 начинается накануне — DTSTART раньше DTEND', async () => {
    const [{ id: night }] = await testSql`insert into event (event_date, start_time, arrive_time, concert)
      values ('2099-07-11', '00:30', '23:00', 'Ночное') returning id`;
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${night}, ${tix}, 1)`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${night}, ${tix})`;
    const text = unfold(await asWorker(ian, (tx) => workerFeed(tx, ian, { now, origin })));
    const block = text.split('BEGIN:VEVENT').find((b) => b.includes(`shift-${night}-`)) ?? '';
    expect(block).toContain('DTSTART:20990710T200000Z');
    expect(block).toContain('DTEND:20990710T230000Z');
  });
});

describe('приход позже начала — опечатка, а не полночь', () => {
  it('начало вечером (20:00), приход 20:15 — событие начинается со start, без ~25 часов', async () => {
    const [{ id: typo }] = await testSql`insert into event (event_date, start_time, arrive_time, concert)
      values ('2099-07-12', '20:00', '20:15', 'Опечатка') returning id`;
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${typo}, ${tix}, 1)`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${typo}, ${tix})`;
    const text = unfold(await asWorker(ian, (tx) => workerFeed(tx, ian, { now, origin })));
    const block = text.split('BEGIN:VEVENT').find((b) => b.includes(`shift-${typo}-`)) ?? '';
    expect(block).toContain('DTSTART:20990712T170000Z');
    expect(block).toContain('DTEND:20990712T183000Z');
  });
});

describe('лента менеджера', () => {
  it('назначенные на должность без мест в событии — в строке «Прочие»', async () => {
    const [{ id: sound }] = await testSql`insert into position (name, sort_order) values ('ЗВУК', 99) returning id`;
    const [{ id: pub2 }] = await testSql`insert into event (event_date, start_time) values ('2099-07-20', '20:00') returning id`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${pub2}, ${sound})`;
    const text = unfold(await asManager((tx) => managerFeed(tx, { now, origin })));
    const block = text.split('BEGIN:VEVENT').find((b) => b.includes(`event-${pub2}@`)) ?? '';
    expect(block).toContain('Прочие: Ян Образцовый (ЗВУК)');
    // у события, где место под должность есть, строки «Прочие» нет
    const pubBlock = text.split('BEGIN:VEVENT').find((b) => b.includes(`event-${pub}@`)) ?? '';
    expect(pubBlock).not.toContain('Прочие');
  });

  it('все мероприятия с набором, черновик помечен, люди по должностям', async () => {
    const text = unfold(await asManager((tx) => managerFeed(tx, { now, origin })));
    expect(text).toContain(`UID:event-${pub}@annenkirche-shifts`);
    expect(text).toContain('SUMMARY:Лунный свет · 1/2');
    expect(text).toContain('SUMMARY:[черновик] Ночной орган · 1/2');
    expect(text).not.toContain('Давнее');
    expect(text).toContain('БИЛЕТЫ: Ян Образцовый\\, свободно');
    expect(text).toContain(`https://a.app/event/${pub}`);
  });
});
