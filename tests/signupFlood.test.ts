import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, testSql, asWorker, asManager } from './setup';
import { createSignup, withdrawSignup, SIGNUP_TOO_OFTEN } from '@/app/(worker)/queries';
import { processEvents } from '@/lib/telegram/process';
import { runTick } from '@/lib/telegram/tick';

/**
 * M3 полного ревью безопасности: один работник не может завалить менеджера уведомлениями
 * и задержать уведомления всех остальных (заявка ↔ отзыв по кругу).
 */
const o = 'https://a.app';
const now = new Date('2099-07-08T09:00:00Z');
let ian: string; let pol: string; let ev: string; let hall: string;

beforeEach(async () => {
  await resetTestDb();
  [{ id: ian }] = await testSql`insert into worker (full_name, name_key) values ('Ян', 'ян') returning id`;
  [{ id: pol }] = await testSql`insert into worker (full_name, name_key) values ('Полина', 'полина') returning id`;
  [{ id: hall }] = await testSql`select id from position where name = 'ЗАЛ'`;
  [{ id: ev }] = await testSql`insert into event (event_date, start_time, arrive_time, concert)
    values ('2099-07-10', '20:00', '18:00', 'Лунный свет') returning id`;
  await testSql`insert into event_slot (event_id, position_id, quantity) values (${ev}, ${hall}, 2)`;
  await testSql`insert into telegram_link (worker_id, chat_id) values (${ian}, 101), (${pol}, 102), (null, 900)`;
  await testSql`delete from tg_event`;
});

const signup = (worker: string, event = ev) => asWorker(worker, (tx) => createSignup(tx, { workerId: worker, eventId: event }));
const withdraw = (worker: string, event = ev) => asWorker(worker, (tx) => withdrawSignup(tx, { workerId: worker, eventId: event }));
const managerMessages = async () =>
  (await testSql`select text from tg_outbox where chat_id = 900 order by id`).map((r) => r.text as string);
const pendingSignupEvents = async (worker: string) => (await testSql<{ n: number }[]>`
  select count(*)::int as n from tg_event where kind = 'm_signup' and worker_id = ${worker} and processed_at is null`)[0].n;

describe('лимит заявок и отзывов на работника (сервер, 0015)', () => {
  it('одно мероприятие: не больше 6 переключений в час, потом — понятный отказ; другой работник не задет', async () => {
    for (let i = 0; i < 3; i++) {
      await signup(pol);
      await withdraw(pol);
    }
    await expect(signup(pol)).rejects.toThrow(SIGNUP_TOO_OFTEN);
    await expect(signup(ian)).resolves.toBeUndefined();
  });

  it('все мероприятия вместе: не больше 60 заявок и отзывов за 10 минут', async () => {
    const events = await testSql<{ id: string }[]>`
      insert into event (event_date, start_time, concert)
      select '2099-07-11'::date + g, '20:00', 'Поток ' || g from generate_series(1, 61) g returning id`;
    for (const e of events.slice(0, 60)) await signup(pol, e.id);
    await expect(signup(pol, events[60].id)).rejects.toThrow(SIGNUP_TOO_OFTEN);
    await expect(withdraw(pol, events[0].id)).rejects.toThrow(SIGNUP_TOO_OFTEN);
    expect((await testSql`select 1 from signup where worker_id = ${pol}`).length).toBe(60);
  });

  it('учёт старше часа не мешает и убирается', async () => {
    await testSql`insert into signup_toggle (worker_id, event_id, at)
      select ${pol}, ${ev}, now() - interval '2 hours' from generate_series(1, 100)`;
    await expect(signup(pol)).resolves.toBeUndefined();
    expect((await testSql`select 1 from signup_toggle where at < now() - interval '1 hour'`).length).toBe(0);
  });

  it('учёт закрыт для приложения: app_user не читает и не пишет signup_toggle напрямую', async () => {
    await expect(asWorker(pol, (tx) => tx`select * from signup_toggle`)).rejects.toThrow(/permission denied/);
    await expect(asManager((tx) => tx`delete from signup_toggle`)).rejects.toThrow(/permission denied/);
  });
});

describe('уведомления менеджера о заявках не повторяются', () => {
  it('заявка, отзыв и снова заявка до обработки журнала — одна запись m_signup', async () => {
    await signup(pol);
    await withdraw(pol);
    await signup(pol);
    expect(await pendingSignupEvents(pol)).toBe(1);
  });

  it('заявку отозвали до обработки — менеджеру ничего', async () => {
    await signup(pol);
    await withdraw(pol);
    await asManager((tx) => processEvents(tx, now, o));
    expect(await managerMessages()).toEqual([]);
  });

  it('повторная заявка в течение часа после уведомления — без второго сообщения; позже — снова сообщение', async () => {
    await signup(pol);
    await asManager((tx) => processEvents(tx, now, o));
    expect(await managerMessages()).toHaveLength(1);
    await withdraw(pol);
    await signup(pol);
    await asManager((tx) => processEvents(tx, now, o));
    expect(await managerMessages()).toHaveLength(1);

    await testSql`update tg_outbox set created_at = created_at - interval '2 hours'`;
    await withdraw(pol);
    await signup(pol);
    await asManager((tx) => processEvents(tx, now, o));
    expect(await managerMessages()).toHaveLength(2);
  });
});

describe('очередь tg_event: поток одного работника не задерживает остальных', () => {
  it('тысяча повторов одной заявки сливаются; настоящее уведомление другому работнику уходит в тот же тик', async () => {
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    await testSql`insert into tg_event (kind, worker_id, event_id)
      select 'm_signup', ${pol}, ${ev} from generate_series(1, 1000)`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await asManager((tx) => processEvents(tx, now, o, 200));
    const toIan = await testSql`select text from tg_outbox where chat_id = 101`;
    expect(toIan.some((r) => (r.text as string).startsWith('✅ <b>Вас поставили на смену</b>'))).toBe(true);
    expect(await managerMessages()).toHaveLength(1);
    expect(await testSql`select 1 from tg_event where processed_at is null`).toHaveLength(0);
  });

  it('за один тик обрабатывается не больше limit разных уведомлений, остальные — в следующий', async () => {
    const events = await testSql<{ id: string }[]>`
      insert into event (event_date, start_time, concert)
      select '2099-07-11'::date + g, '20:00', 'Поток ' || g from generate_series(1, 5) g returning id`;
    await testSql`delete from tg_event`;
    for (const e of events) await testSql`insert into tg_event (kind, worker_id, event_id) values ('m_signup', ${pol}, ${e.id})`;
    expect(await asManager((tx) => processEvents(tx, now, o, 3))).toBe(3);
    expect(await testSql`select 1 from tg_event where processed_at is null`).toHaveLength(2);
    expect(await asManager((tx) => processEvents(tx, now, o, 3))).toBe(2);
  });

  it('уборка: необработанные записи старше суток гасятся без сообщений', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`update tg_event set created_at = now() - interval '2 days'`;
    await runTick({ now, origin: o, api: null, secret: null, db: asManager });
    expect(await testSql`select 1 from tg_event where processed_at is null`).toHaveLength(0);
    expect(await testSql`select 1 from tg_outbox where chat_id = 101`).toHaveLength(0);
  });
});
