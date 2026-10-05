import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asWorker, asManager, asAppAnon } from './setup';
import { getLink, issueLinkCode, linkTelegram, telegramOwner, unlink } from '@/lib/telegram/links';

let ian: string; let pol: string; let ev: string; let hall: string;

beforeEach(async () => {
  await resetTestDb();
  [{ id: ian }] = await testSql`insert into worker (full_name, name_key) values ('Ян', 'ян') returning id`;
  [{ id: pol }] = await testSql`insert into worker (full_name, name_key) values ('Полина', 'полина') returning id`;
  [{ id: hall }] = await testSql`select id from position where name = 'ЗАЛ'`;
  [{ id: ev }] = await testSql`insert into event (event_date, start_time, arrive_time, concert)
    values ('2099-07-10', '20:00', '18:00', 'Лунный свет') returning id`;
  await testSql`insert into event_slot (event_id, position_id, quantity) values (${ev}, ${hall}, 2)`;
  // Вставка места сама пишет free_place — журнал начинаем с чистого листа.
  await testSql`delete from tg_event`;
});

const events = async () => (await testSql`select kind, worker_id, event_id from tg_event order by id`)
  .map((r) => [r.kind, r.worker_id, r.event_id]);

describe('привязка чата', () => {
  it('код работника → привязка, код одноразовый', async () => {
    const code = await asWorker(ian, (tx) => issueLinkCode(tx, ian));
    expect(await asAppAnon((tx) => linkTelegram(tx, code, 111))).toBe('worker');
    expect(await asAppAnon((tx) => linkTelegram(tx, code, 111))).toBe('invalid');
    expect(await asAppAnon((tx) => telegramOwner(tx, 111))).toEqual({ workerId: ian, isManager: false });
    expect((await asWorker(ian, (tx) => getLink(tx, ian)))?.chatId).toBe(111);
  });

  it('истёкший код не действует', async () => {
    const code = await asWorker(ian, (tx) => issueLinkCode(tx, ian));
    await testSql`update telegram_link_code set expires_at = now() - interval '1 minute'`;
    expect(await asAppAnon((tx) => linkTelegram(tx, code, 111))).toBe('invalid');
  });

  it('чат переходит к новому владельцу, у владельца один чат', async () => {
    const a = await asWorker(ian, (tx) => issueLinkCode(tx, ian));
    await asAppAnon((tx) => linkTelegram(tx, a, 111));
    const b = await asWorker(pol, (tx) => issueLinkCode(tx, pol));
    await asAppAnon((tx) => linkTelegram(tx, b, 111));
    expect(await asAppAnon((tx) => telegramOwner(tx, 111))).toEqual({ workerId: pol, isManager: false });
    const c = await asWorker(pol, (tx) => issueLinkCode(tx, pol));
    await asAppAnon((tx) => linkTelegram(tx, c, 222));
    expect(await asAppAnon((tx) => telegramOwner(tx, 111))).toBeNull();
    expect(await asAppAnon((tx) => telegramOwner(tx, 222))).toEqual({ workerId: pol, isManager: false });
  });

  it('менеджер', async () => {
    const code = await asManager((tx) => issueLinkCode(tx, null));
    expect(await asAppAnon((tx) => linkTelegram(tx, code, 999))).toBe('manager');
    expect(await asAppAnon((tx) => telegramOwner(tx, 999))).toEqual({ workerId: null, isManager: true });
    await asManager((tx) => unlink(tx, null));
    expect(await asAppAnon((tx) => telegramOwner(tx, 999))).toBeNull();
  });

  it('код архивного работника не действует', async () => {
    const code = await asWorker(ian, (tx) => issueLinkCode(tx, ian));
    await testSql`update worker set status = 'archived' where id = ${ian}`;
    expect(await asAppAnon((tx) => linkTelegram(tx, code, 111))).toBe('invalid');
    expect(await testSql`select 1 from telegram_link_code`).toEqual([]);
  });

  it('работник не видит чужие привязки и не выдаёт код менеджера', async () => {
    const code = await asWorker(pol, (tx) => issueLinkCode(tx, pol));
    await asAppAnon((tx) => linkTelegram(tx, code, 333));
    expect(await asWorker(ian, (tx) => tx`select 1 from telegram_link`)).toEqual([]);
    await expect(asWorker(ian, (tx) => issueLinkCode(tx, null))).rejects.toThrow(/permission denied/);
  });

  it('работник не создаёт привязку и не меняет chat_id, но меняет свои настройки', async () => {
    await expect(asWorker(ian, (tx) => tx`insert into telegram_link (worker_id, chat_id) values (${ian}, 999)`))
      .rejects.toThrow(/permission denied/);
    const code = await asWorker(ian, (tx) => issueLinkCode(tx, ian));
    await asAppAnon((tx) => linkTelegram(tx, code, 111));
    await expect(asWorker(ian, (tx) => tx`update telegram_link set chat_id = 999 where worker_id = ${ian}`))
      .rejects.toThrow(/permission denied/);
    await asWorker(ian, (tx) => tx`update telegram_link set prefs = '{"assigned": false}' where worker_id = ${ian}`);
    expect((await asWorker(ian, (tx) => getLink(tx, ian)))?.prefs).toEqual({ assigned: false });
    await asWorker(ian, (tx) => unlink(tx, ian));
    expect(await asAppAnon((tx) => telegramOwner(tx, 111))).toBeNull();
  });

  it('код нельзя вставить напрямую, срок ставит функция', async () => {
    await expect(asWorker(ian, (tx) => tx`insert into telegram_link_code (code_hash, worker_id, expires_at)
      values ('h', ${ian}, '9999-01-01')`)).rejects.toThrow(/permission denied/);
    await expect(asManager((tx) => tx`insert into telegram_link_code (code_hash, worker_id, expires_at)
      values ('h', null, '9999-01-01')`)).rejects.toThrow(/permission denied/);
    await expect(asAppAnon((tx) => issueLinkCode(tx, ian))).rejects.toThrow(/permission denied/);
    await asWorker(ian, (tx) => issueLinkCode(tx, ian));
    await asWorker(ian, (tx) => issueLinkCode(tx, ian));
    const rows = await testSql`
      select worker_id, extract(epoch from expires_at - now())::int as left from telegram_link_code`;
    expect(rows).toHaveLength(1);
    expect(rows[0].worker_id).toBe(ian);
    expect(rows[0].left).toBeGreaterThanOrEqual(15 * 60 - 5);
    expect(rows[0].left).toBeLessThanOrEqual(15 * 60);
  });

  it('привязка — только из сессии без личности: работник и менеджер получают invalid, код не гасится', async () => {
    const code = await asWorker(ian, (tx) => issueLinkCode(tx, ian));
    expect(await asWorker(ian, (tx) => linkTelegram(tx, code, 111))).toBe('invalid');
    expect(await asManager((tx) => linkTelegram(tx, code, 111))).toBe('invalid');
    expect(await testSql`select 1 from telegram_link_code`).toHaveLength(1);
    expect(await testSql`select 1 from telegram_link`).toEqual([]);
    expect(await asAppAnon((tx) => linkTelegram(tx, code, 111))).toBe('worker');
  });

  it('владелец кода — из личности сессии, а не из аргумента', async () => {
    const code = await asWorker(ian, (tx) => issueLinkCode(tx, pol));
    expect(await asAppAnon((tx) => linkTelegram(tx, code, 111))).toBe('worker');
    expect(await asAppAnon((tx) => telegramOwner(tx, 111))).toEqual({ workerId: ian, isManager: false });
  });
});

describe('журнал событий (триггеры)', () => {
  it('назначение, смена должности, «Не смогу», оставили, сняли после отмены', async () => {
    const [{ id: box }] = await testSql`select id from position where name = 'КАССА'`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`update assignment set position_id = ${box} where worker_id = ${ian}`;
    await testSql`update assignment set cancel_requested_at = now() where worker_id = ${ian}`;
    await testSql`update assignment set cancel_requested_at = null where worker_id = ${ian}`;
    await testSql`update assignment set cancel_requested_at = now() where worker_id = ${ian}`;
    await testSql`delete from assignment where worker_id = ${ian}`;
    expect(await events()).toEqual([
      ['assigned', ian, ev], ['assigned', ian, ev], ['m_cancel', ian, ev], ['kept', ian, ev],
      ['m_cancel', ian, ev], ['cancel_approved', ian, ev], ['free_place', null, ev],
    ]);
    const [snap] = await testSql`select payload from tg_event where kind = 'cancel_approved'`;
    expect(snap.payload).toMatchObject({ date: '2099-07-10', start: '20:00', arrive: '18:00', concert: 'Лунный свет' });
  });

  it('удаление мероприятия — «отменено» назначенным со снимком', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`delete from tg_event`;
    await testSql`delete from event where id = ${ev}`;
    const rows = await testSql`select kind, worker_id, payload from tg_event order by id`;
    expect(rows.map((r) => [r.kind, r.worker_id])).toEqual([['event_cancelled', ian]]);
    expect(rows[0].payload).toMatchObject({ concert: 'Лунный свет', date: '2099-07-10' });
  });

  it('время мероприятия, заявки, публикация, рост мест', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`delete from tg_event`;
    await testSql`update event set start_time = '19:30' where id = ${ev}`;
    await testSql`update event set concert = 'Другое' where id = ${ev}`;
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    await testSql`update signup set status = 'rejected' where worker_id = ${pol}`;
    await testSql`insert into month (month, status) values ('2099-09', 'draft')`;
    await testSql`update month set status = 'published' where month = '2099-09'`;
    await testSql`update event_slot set quantity = 3 where event_id = ${ev}`;
    await testSql`update event_slot set quantity = 1 where event_id = ${ev}`;
    const rows = await testSql`select kind, worker_id, event_id, month from tg_event order by id`;
    expect(rows.map((r) => [r.kind, r.worker_id, r.event_id ?? r.month])).toEqual([
      ['time_changed', ian, ev], ['m_signup', pol, ev], ['rejected', pol, ev],
      ['published', null, '2099-09'], ['free_place', null, ev],
    ]);
  });

  it('работник пишет события своими действиями (триггер в обход RLS), но не читает журнал', async () => {
    await testSql`update event set event_date = '2099-07-10'`;
    await asWorker(pol, (tx) => tx`insert into signup (worker_id, event_id) values (${pol}, ${ev})`);
    expect((await events()).map((e) => e[0])).toContain('m_signup');
    expect(await asWorker(pol, (tx) => tx`select 1 from tg_event`)).toEqual([]);
  });

  it('снятие без запроса отмены — removed со снимком', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`delete from tg_event`;
    await testSql`delete from assignment where worker_id = ${ian}`;
    expect(await events()).toEqual([['removed', ian, ev], ['free_place', null, ev]]);
  });

  it('очередь: менеджер пишет, работник не видит', async () => {
    await asManager((tx) => tx`insert into tg_outbox (chat_id, text, dedupe_key) values (111, 'т', 'k')`);
    expect(await asWorker(ian, (tx) => tx`select 1 from tg_outbox`)).toEqual([]);
    expect(await asManager((tx) => tx`select text from tg_outbox`)).toEqual([{ text: 'т' }]);
  });

  it('новое место на мероприятии — free_place, пустое — нет', async () => {
    const [{ id: box }] = await testSql`select id from position where name = 'КАССА'`;
    const [{ id: adm }] = await testSql`select id from position where name = 'АДМИН'`;
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${ev}, ${adm}, 0)`;
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${ev}, ${box}, 1)`;
    expect(await events()).toEqual([['free_place', null, ev]]);
  });

  it('смена даты — time_changed; повторная публикация — без published', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`insert into month (month, status) values ('2099-09', 'published')`;
    await testSql`delete from tg_event`;
    await testSql`update event set event_date = '2099-07-11' where id = ${ev}`;
    await testSql`update month set status = 'published', published_at = now() where month = '2099-09'`;
    expect(await events()).toEqual([['time_changed', ian, ev]]);
  });

  it('работник не пишет журнал и служебное состояние, tg_note не исполним', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`insert into app_state (name, value) values ('k', 'v')`;
    const upd = await asWorker(ian, (tx) => tx`update tg_event set processed_at = now()`);
    expect(upd.count).toBe(0);
    expect(await testSql`select 1 from tg_event where processed_at is not null`).toEqual([]);
    const st = await asWorker(ian, (tx) => tx`update app_state set value = 'x'`);
    expect(st.count).toBe(0);
    await expect(asWorker(ian, (tx) => tx`insert into app_state (name, value) values ('z', 'z')`))
      .rejects.toThrow(/row-level security/);
    expect(await testSql`select value from app_state`).toEqual([{ value: 'v' }]);
    await expect(asManager((tx) => tx`select tg_note('assigned', null, null, null, null)`))
      .rejects.toThrow(/permission denied/);
    await expect(asWorker(ian, (tx) => tx`select tg_note('assigned', null, null, null, null)`))
      .rejects.toThrow(/permission denied/);
  });

  it('секрет тика', async () => {
    const [{ value }] = await testSql`select value from app_secret where name = 'tick'`;
    expect(value).toHaveLength(64);
    const ok = await asAppAnon((tx) => tx`select tick_secret_valid(${value}) as ok`);
    expect(ok[0].ok).toBe(true);
    const bad = await asAppAnon((tx) => tx`select tick_secret_valid('x') as ok`);
    expect(bad[0].ok).toBe(false);
    await expect(asManager((tx) => tx`select value from app_secret`)).rejects.toThrow(/permission denied/);
  });
});
