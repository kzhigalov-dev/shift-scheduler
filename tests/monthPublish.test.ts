import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asWorker, asManager } from './setup';

let worker: string;
let draftEvent: string;
let draftFree: string;
let pubEvent: string;
let hall: string;

beforeEach(async () => {
  await resetTestDb();
  const [w] = await testSql`insert into worker (full_name, name_key) values ('Алиса', 'алиса') returning id`;
  worker = w.id;
  await testSql`insert into month (month, status) values ('2099-08', 'draft')`;
  const [d] = await testSql`insert into event (event_date, start_time) values ('2099-08-05', '20:00') returning id`;
  const [f] = await testSql`insert into event (event_date, start_time) values ('2099-08-06', '20:00') returning id`;
  const [p] = await testSql`insert into event (event_date, start_time) values ('2099-07-05', '20:00') returning id`;
  const [h] = await testSql`select id from position where name = 'ЗАЛ'`;
  draftEvent = d.id; draftFree = f.id; pubEvent = p.id; hall = h.id;
  for (const e of [draftEvent, draftFree, pubEvent]) {
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${e}, ${hall}, 2)`;
  }
  for (const e of [draftEvent, pubEvent]) {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${worker}, ${e}, ${hall})`;
  }
});

describe('записи месяцев', () => {
  it('событие в месяце без записи создаёт опубликованный месяц', async () => {
    const [m] = await testSql`select status::text as status from month where month = '2099-07'`;
    expect(m.status).toBe('published');
  });

  it('событие не перетирает черновик', async () => {
    const [m] = await testSql`select status::text as status from month where month = '2099-08'`;
    expect(m.status).toBe('draft');
  });

  it('перенос события в другой месяц создаёт запись этого месяца', async () => {
    await testSql`update event set event_date = '2099-09-01' where id = ${pubEvent}`;
    const [m] = await testSql`select status::text as status from month where month = '2099-09'`;
    expect(m.status).toBe('published');
  });

  it('новое событие — приход автоматический, без исходного названия', async () => {
    const [e] = await testSql`select arrive_manual, source_title from event where id = ${draftEvent}`;
    expect(e).toEqual({ arrive_manual: false, source_title: null });
  });

  it('номер строки таблицы у назначения необязателен и не отрицателен', async () => {
    await expect(testSql`update assignment set plan_row = -1 where event_id = ${pubEvent}`).rejects.toThrow();
    await testSql`update assignment set plan_row = 2 where event_id = ${pubEvent}`;
  });
});

describe('работник не видит черновик', () => {
  it('события', async () => {
    const rows = await asWorker(worker, (tx) => tx`select id from event`);
    expect(rows.map((r) => r.id)).toEqual([pubEvent]);
  });

  it('места', async () => {
    const rows = await asWorker(worker, (tx) => tx`select event_id from event_slot`);
    expect(rows.map((r) => r.event_id)).toEqual([pubEvent]);
  });

  it('свои назначения', async () => {
    const rows = await asWorker(worker, (tx) => tx`select event_id from assignment`);
    expect(rows.map((r) => r.event_id)).toEqual([pubEvent]);
  });

  it('свои заявки', async () => {
    await testSql`insert into signup (worker_id, event_id) values (${worker}, ${draftFree})`;
    const rows = await asWorker(worker, (tx) => tx`select event_id from signup`);
    expect(rows).toEqual([]);
  });

  it('не может подать заявку на событие черновика', async () => {
    await expect(asWorker(worker, (tx) => tx`
      insert into signup (worker_id, event_id) values (${worker}, ${draftFree})`))
      .rejects.toThrow(/row-level security/);
  });

  it('не может запросить отмену смены черновика', async () => {
    const [draft] = await asWorker(worker, (tx) => tx`select request_cancel(${draftEvent}) as ok`);
    expect(draft.ok).toBe(false);
    const [pub] = await asWorker(worker, (tx) => tx`select request_cancel(${pubEvent}) as ok`);
    expect(pub.ok).toBe(true);
  });

  it('видит только опубликованные месяцы', async () => {
    const rows = await asWorker(worker, (tx) => tx`select month from month order by month`);
    expect(rows.map((r) => r.month)).toEqual(['2099-07']);
  });

  it('после публикации видит всё', async () => {
    await testSql`update month set status = 'published' where month = '2099-08'`;
    const rows = await asWorker(worker, (tx) => tx`select id from event`);
    expect(rows).toHaveLength(3);
  });
});

describe('менеджер', () => {
  it('видит черновик и публикует месяц', async () => {
    const rows = await asManager((tx) => tx`select id from event`);
    expect(rows).toHaveLength(3);
    await asManager((tx) => tx`update month set status = 'published', published_at = now() where month = '2099-08'`);
    const [m] = await testSql`select status::text as status from month where month = '2099-08'`;
    expect(m.status).toBe('published');
  });

  it('не может удалить месяц: события пропали бы у работников', async () => {
    await expect(asManager((tx) => tx`delete from month where month = '2099-08'`))
      .rejects.toThrow(/permission denied/);
    const rows = await testSql`select month from month where month = '2099-08'`;
    expect(rows).toHaveLength(1);
  });
});
