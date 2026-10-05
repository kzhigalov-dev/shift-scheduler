import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetTestDb, testSql, asManager } from './setup';
import { insertMessages, processEvents } from '@/lib/telegram/process';
import { deliverDue } from '@/lib/telegram/delivery';
import { deliverBudgetMs, enqueueReminders, enqueueUnderstaffed, ensureWebhook, runTick, TICK_BUDGET_MS } from '@/lib/telegram/tick';
import { telegramApi } from '@/lib/telegram/api';
import { deepLink, webhookSecret } from '@/lib/telegram/config';
import { createHash } from 'node:crypto';
import { encodeCallback, type Callback } from '@/lib/telegram/callbacks';
import { createEvent } from '@/lib/events';
import { saveEventType } from '@/lib/eventTypes/operations';
import { applyEventTemplate, applyTypeTemplate } from '@/lib/eventTypes/applyTemplate';
import { eventInput, slotsFor } from './eventTypeFixtures';
import { fakeApi } from './telegramFakes';

const o = 'https://a.app';
const link = (path: string, text = 'Открыть в приложении') => ({ text, url: `${o}${path}` });
/** Работнику — кнопка Mini App «Открыть приложение» вместо URL-кнопки. */
const login = (to: string) => ({ text: 'Открыть приложение', web_app: { url: `${o}/tg/app?${new URLSearchParams({ to })}` } });
let ian: string; let pol: string; let ev: string; let hall: string;
const now = new Date('2099-07-08T09:00:00Z'); // 12:00 по Москве, мероприятие через 2 дня

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

const outbox = async () => (await testSql`select chat_id, text, dedupe_key from tg_outbox order by id`)
  .map((r): [number, string] => [Number(r.chat_id), r.text as string]);
const pending = async () => testSql`select 1 from tg_event where processed_at is null`;

describe('processEvents', () => {
  it('назначение → сообщение работнику, свободное место → остальным, заявка → менеджеру', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    await testSql`delete from assignment where worker_id = ${ian}`;
    await asManager((tx) => processEvents(tx, now, o));
    const rows = await outbox();
    expect(rows.find(([c, t]) => c === 101 && t.startsWith('✅ <b>Вас поставили на смену</b>'))).toBeTruthy();
    expect(rows.find(([c, t]) => c === 900 && t.startsWith('📥 <b>Новая заявка</b>\n👤 Полина'))).toBeTruthy();
    expect(rows.find(([c, t]) => c === 101 && t.startsWith('❌ <b>Вас сняли со смены</b>'))).toBeTruthy();
    expect(rows.filter(([, t]) => t.startsWith('🙋 <b>Нужен человек</b>')).map(([c]) => c).sort()).toEqual([101, 102]);
    expect(await pending()).toHaveLength(0);
  });

  it('черновик и прошедшее — без сообщений; выключенная настройка — без сообщения', async () => {
    await testSql`insert into month (month, status) values ('2099-08', 'draft')`;
    const [{ id: draft }] = await testSql`insert into event (event_date, start_time) values ('2099-08-05', '20:00') returning id`;
    await testSql`insert into assignment (worker_id, event_id) values (${ian}, ${draft})`;
    await testSql`update telegram_link set prefs = '{"assignments": false}' where chat_id = 102`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${pol}, ${ev}, ${hall})`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await outbox()).toEqual([]);
  });

  it('публикация — сводка каждому подключённому', async () => {
    await testSql`insert into month (month, status) values ('2099-09', 'draft')`;
    const [{ id: e9 }] = await testSql`insert into event (event_date, start_time, concert) values ('2099-09-05', '20:00', 'Сентябрь') returning id`;
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${e9}, ${hall}, 3)`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${e9}, ${hall})`;
    await testSql`delete from tg_event`;
    await testSql`update month set status = 'published' where month = '2099-09'`;
    await asManager((tx) => processEvents(tx, now, o));
    const rows = await outbox();
    // Между числом и словом — неразрывный пробел (messages.ts).
    expect(rows.find(([c, t]) => c === 101 && t === '🗓 <b>Опубликованы смены на сентябрь</b>\nУ вас 1\u00a0смена.\nСвободных мест: 2.')).toBeTruthy();
    expect(rows.find(([c, t]) => c === 102 && t.includes('У вас 0\u00a0смен.'))).toBeTruthy();
  });

  it('назначения черновика, опубликованного до обработки журнала — только сводка; после публикации — как обычно', async () => {
    await testSql`insert into month (month, status) values ('2099-09', 'draft')`;
    const [{ id: e9 }] = await testSql`insert into event (event_date, start_time, concert) values ('2099-09-05', '20:00', 'Сентябрь') returning id`;
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${e9}, ${hall}, 3)`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${e9}, ${hall})`;
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${e9})`;
    await testSql`delete from tg_event where kind in ('assigned', 'free_place') and event_id = ${ev}`; // события другого месяца из beforeEach
    // Как publishMonth: status и published_at = now(); журнал НЕ чистим — тик ещё не успел.
    await testSql`update month set status = 'published', published_at = now() where month = '2099-09'`;
    const [{ n }] = await testSql`select count(*)::int as n from tg_event where kind in ('assigned', 'free_place', 'm_signup') and event_id = ${e9}`;
    expect(n).toBeGreaterThan(0);
    await asManager((tx) => processEvents(tx, now, o));
    let rows = await outbox();
    expect(rows.filter(([, t]) => t.startsWith('✅ <b>Вас поставили'))).toEqual([]);
    expect(rows.filter(([, t]) => t.startsWith('🙋 <b>Нужен человек'))).toEqual([]);
    expect(rows.filter(([c, t]) => c === 900 && t.startsWith('📥 <b>Новая заявка'))).toEqual([]);
    expect(rows.filter(([, t]) => t.includes('смен')).map(([c]) => c).sort()).toEqual([101, 102]);
    expect(rows.find(([c, t]) => c === 101 && t.includes('У вас 1\u00a0смена.'))).toBeTruthy();
    expect(await pending()).toHaveLength(0);

    // Событие после публикации — обычное сообщение.
    await testSql`delete from tg_outbox`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${pol}, ${e9}, ${hall})`;
    await asManager((tx) => processEvents(tx, now, o));
    rows = await outbox();
    expect(rows.find(([c, t]) => c === 102 && t.startsWith('✅ <b>Вас поставили на смену</b>'))).toBeTruthy();
  });

  it('назначение без должности — «без должности»; несколько назначений в пачке — одно сообщение', async () => {
    await testSql`insert into assignment (worker_id, event_id) values (${ian}, ${ev})`;
    await asManager((tx) => processEvents(tx, now, o));
    let rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toContain('👤 Без должности');

    await testSql`delete from tg_outbox`;
    await testSql`update assignment set position_id = ${hall} where worker_id = ${ian}`;
    await testSql`update assignment set position_id = null where worker_id = ${ian}`;
    await testSql`update assignment set position_id = ${hall} where worker_id = ${ian}`;
    await asManager((tx) => processEvents(tx, now, o));
    rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toContain('👤 ЗАЛ');
    expect(await pending()).toHaveLength(0);
  });

  it('снятие и отмена мероприятия в черновике или в прошлом — без сообщений', async () => {
    await testSql`insert into month (month, status) values ('2099-08', 'draft')`;
    const [{ id: draft }] = await testSql`insert into event (event_date, start_time) values ('2099-08-05', '20:00') returning id`;
    const [{ id: past }] = await testSql`insert into event (event_date, start_time) values ('2099-07-01', '20:00') returning id`;
    await testSql`insert into assignment (worker_id, event_id) values (${ian}, ${draft}), (${pol}, ${draft}), (${ian}, ${past}), (${pol}, ${past})`;
    await testSql`delete from tg_event`;
    await testSql`delete from assignment where worker_id = ${ian}`;
    await testSql`delete from event where id in (${draft}, ${past})`;
    const kinds = (await testSql`select kind from tg_event`).map((r) => r.kind as string);
    expect(kinds).toEqual(expect.arrayContaining(['removed', 'event_cancelled']));
    await asManager((tx) => processEvents(tx, now, o));
    expect(await outbox()).toEqual([]);
    expect(await pending()).toHaveLength(0);
  });

  it('снятие в опубликованном будущем — по снимку', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`delete from tg_event`;
    await testSql`delete from event where id = ${ev}`;
    await asManager((tx) => processEvents(tx, now, o));
    const rows = await outbox();
    expect(rows).toEqual([[101, expect.stringContaining('Мероприятие отменено')]]);
  });

  it('неподключённый получатель — без сообщения, событие обработано', async () => {
    await testSql`delete from telegram_link`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    expect(await asManager((tx) => processEvents(tx, now, o))).toBe(2);
    expect(await outbox()).toEqual([]);
    expect(await pending()).toHaveLength(0);
  });

  it('«Не смогу» → менеджеру, оставили → работнику, одобрили отмену → работнику', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall}), (${pol}, ${ev}, ${hall})`;
    await testSql`delete from tg_event`;
    await testSql`update assignment set cancel_requested_at = now() where event_id = ${ev}`;
    await asManager((tx) => processEvents(tx, now, o));
    expect((await outbox()).filter(([c]) => c === 900).map(([, t]) => t.split('\n').slice(0, 2).join(' / ')).sort())
      .toEqual(['⚠️ <b>Не сможет выйти</b> / 👤 Полина', '⚠️ <b>Не сможет выйти</b> / 👤 Ян']);
    await testSql`delete from tg_outbox`;

    await testSql`update assignment set cancel_requested_at = null where worker_id = ${ian}`;
    await testSql`delete from assignment where worker_id = ${pol}`;
    await asManager((tx) => processEvents(tx, now, o));
    const rows = await outbox();
    expect(rows.find(([c, t]) => c === 101 && t.startsWith('📌 <b>Менеджер оставил вас на смене</b>'))).toBeTruthy();
    expect(rows.find(([c, t]) => c === 102 && t.startsWith('👌 <b>Отмену одобрили</b>'))).toBeTruthy();
    expect(rows.find(([c, t]) => c === 102 && t.startsWith('🙋 <b>Нужен человек</b>'))).toBeTruthy();
    expect(rows.filter(([c]) => c === 101)).toHaveLength(1);
  });

  it('заявку отклонили → работнику', async () => {
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    await testSql`delete from tg_event`;
    await testSql`update signup set status = 'rejected' where worker_id = ${pol}`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await outbox()).toEqual([[102, '🙅 <b>Заявку отклонили</b>\n🗓 Пт, 10\u00a0июля\n🕕 Приход 18:00 · начало 20:00\n🎵 Лунный свет']]);
  });

  it('время изменилось → назначенным; «изменилось время» и «оставили» без назначения — не шлём', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`delete from tg_event`;
    await testSql`update event set arrive_time = '17:30' where id = ${ev}`;
    await testSql`insert into tg_event (kind, worker_id, event_id) values ('time_changed', ${pol}, ${ev}), ('kept', ${pol}, ${ev})`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await outbox()).toEqual([[101, '🔄 <b>Изменилось время смены</b>\n🗓 Пт, 10\u00a0июля\n🕕 Приход 17:30 · начало 20:00\n🎵 Лунный свет\n👤 ЗАЛ']]);
  });

  it('прошедшее мероприятие — без сообщений (назначение, время, заявка)', async () => {
    const [{ id: past }] = await testSql`insert into event (event_date, start_time) values ('2099-07-07', '20:00') returning id`;
    await testSql`insert into assignment (worker_id, event_id) values (${ian}, ${past})`;
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${past})`;
    await testSql`update event set start_time = '19:00' where id = ${past}`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await outbox()).toEqual([]);
    expect(await pending()).toHaveLength(0);
  });

  it('текст длиннее 4000 символов обрезается', async () => {
    await asManager((tx) => insertMessages(tx, [{ chatId: 1, text: 'я'.repeat(5000), key: 'k' }]));
    expect((await outbox())[0][1]).toHaveLength(4000);
  });
});

describe('free_place', () => {
  it('пачка строк по мероприятию — одно сообщение на чат; повтор в течение 6 часов — нет', async () => {
    const [{ id: e2 }] = await testSql`select id from position where name = 'БИЛЕТЫ'`;
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${ev}, ${e2}, 1)`;
    await testSql`update event_slot set quantity = 3 where event_id = ${ev} and position_id = ${hall}`;
    expect((await testSql`select 1 from tg_event where kind = 'free_place'`).length).toBe(2);
    await asManager((tx) => processEvents(tx, now, o));
    const rows = await outbox();
    expect(rows.map(([c]) => c).sort()).toEqual([101, 102]);
    expect(rows[0][1]).toContain('Свободно мест: 4');

    // Время — по часам базы: «отправлено 5 часов назад» — сдвигом created_at.
    await testSql`update tg_outbox set created_at = created_at - interval '5 hours'`;
    await testSql`update event_slot set quantity = 4 where event_id = ${ev} and position_id = ${hall}`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await outbox()).toHaveLength(2);

    await testSql`update tg_outbox set created_at = created_at - interval '2 hours'`;
    await testSql`update event_slot set quantity = 5 where event_id = ${ev} and position_id = ${hall}`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await outbox()).toHaveLength(4);
    // send_after — по часам базы, а не по `now` приложения (2099 год).
    expect(await testSql`select 1 from tg_outbox where send_after > now() + interval '1 minute'`).toEqual([]);
  });

  it('назначенным не шлём; нет мест, дальше 7 дней, черновик, прошлое — не шлём', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`delete from tg_event`;
    await testSql`insert into tg_event (kind, event_id) values ('free_place', ${ev})`;
    await asManager((tx) => processEvents(tx, now, o));
    expect((await outbox()).map(([c]) => c)).toEqual([102]);
    await testSql`delete from tg_outbox`;

    await testSql`insert into assignment (worker_id, event_id, position_id) values (${pol}, ${ev}, ${hall})`;
    const [{ id: far }] = await testSql`insert into event (event_date, start_time) values ('2099-07-20', '20:00') returning id`;
    await testSql`insert into month (month, status) values ('2099-08', 'draft')`;
    const [{ id: draft }] = await testSql`insert into event (event_date, start_time) values ('2099-08-01', '20:00') returning id`;
    const [{ id: past }] = await testSql`insert into event (event_date, start_time) values ('2099-07-07', '20:00') returning id`;
    for (const id of [far, draft, past]) {
      await testSql`insert into event_slot (event_id, position_id, quantity) values (${id}, ${hall}, 2)`;
    }
    await testSql`delete from tg_event where kind <> 'free_place'`;
    await testSql`insert into tg_event (kind, event_id) values ('free_place', ${ev})`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await outbox()).toEqual([]);
    expect(await pending()).toHaveLength(0);
  });
});

describe('free_place: применение шаблона вида', () => {
  /** Вид «Двор» (ЗАЛ 1) и его мероприятия; журнал после создания очищен. */
  async function yard(dates: string[]) {
    const typeId = await asManager(async (tx) => saveEventType(tx, { id: null, name: 'Двор', slots: await slotsFor(tx, { 'ЗАЛ': 1 }) }));
    const ids: string[] = [];
    for (const [i, date] of dates.entries()) {
      ids.push(await asManager((tx) => createEvent(tx, { ...eventInput, date, startTime: `1${i}:00`, concert: `Концерт ${i + 1}`, eventTypeId: typeId })));
    }
    await testSql`delete from tg_event`;
    const grow = async (hall: number, today = '2099-07-08') => {
      await asManager(async (tx) => saveEventType(tx, { id: typeId, name: 'Двор', slots: await slotsFor(tx, { 'ЗАЛ': hall }) }));
      await testSql`delete from tg_event`; // сохранение вида мест не меняет; журнал — только от применения
      return asManager((tx) => applyTypeTemplate(tx, typeId, today));
    };
    return { typeId, ids, grow };
  }
  /** Настоящие сообщения (без ключей-отметок сводки). */
  const sent = async () => (await testSql`select chat_id, text, reply_markup, dedupe_key from tg_outbox where sent_at is null order by id`)
    .map((r) => ({ chat: Number(r.chat_id), text: r.text as string, markup: r.reply_markup, key: r.dedupe_key as string }));

  it('места на 3 мероприятиях одной правкой — одна сводка на чат со всеми тремя', async () => {
    const { ids, grow } = await yard(['2099-07-11', '2099-07-09', '2099-07-10']);
    expect((await grow(2)).applied).toBe(3);
    expect((await testSql`select 1 from tg_event where kind = 'free_place'`).length).toBe(3);
    await asManager((tx) => processEvents(tx, now, o));
    const rows = await sent();
    expect(rows.map((r) => r.chat).sort()).toEqual([101, 102]);
    for (const r of rows) {
      expect(r.text).toBe([
        '🙋 <b>Нужны люди</b>',
        '• Чт, 9\u00a0июля, 11:00 — Концерт 2: 2\u00a0места · 1\u00a0300\u00a0₽',
        '• Пт, 10\u00a0июля, 12:00 — Концерт 3: 2\u00a0места · 1\u00a0300\u00a0₽',
        '• Сб, 11\u00a0июля, 10:00 — Концерт 1: 2\u00a0места · 1\u00a0300\u00a0₽',
      ].join('\n'));
      expect(r.markup).toEqual({ inline_keyboard: [[login('/available')]] });
    }
    // Ключ «раз в 6 часов» — на каждое мероприятие и чат.
    const markers = await testSql`select dedupe_key from tg_outbox where sent_at is not null`;
    for (const id of ids) for (const chat of [101, 102]) {
      expect(markers.filter((m) => (m.dedupe_key as string).startsWith(`free:${id}:`) && (m.dedupe_key as string).endsWith(`:${chat}`))).toHaveLength(1);
    }
    // Ключи-отметки не отправляются: в Telegram уходят только две сводки.
    const { api, calls } = fakeApi();
    expect(await deliverDue(asManager, api, { limit: 50 })).toEqual({ sent: 2, failed: 0 });
    expect(calls.map((c) => String(c.body.text).split('\n')[0])).toEqual(['🙋 <b>Нужны люди</b>', '🙋 <b>Нужны люди</b>']);
  });

  it('из сводки чату подходит одно мероприятие — обычное «Нужен человек» с кнопкой', async () => {
    const { ids, grow } = await yard(['2099-07-09', '2099-07-10']);
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ids[0]}, ${hall})`;
    await grow(3);
    await asManager((tx) => processEvents(tx, now, o));
    const rows = await sent();
    const toIan = rows.filter((r) => r.chat === 101);
    expect(toIan).toHaveLength(1);
    expect(toIan[0].text).toBe('🙋 <b>Нужен человек</b>\n🗓 Пт, 10\u00a0июля\n🕕 Начало 11:00\n🎵 Концерт 2\n💰 1\u00a0300\u00a0₽\nСвободно мест: 3');
    expect(toIan[0].markup).toEqual({ inline_keyboard: [[btn('Записаться', { op: 'su', eventId: ids[1] })], [login('/available')]] });
    expect(toIan[0].key).toMatch(new RegExp(`^free:${ids[1]}:\\d+:101$`));
    expect(rows.filter((r) => r.chat === 102).map((r) => r.text.split('\n')[0])).toEqual(['🙋 <b>Нужны люди</b>']);
  });

  it('применение к одному мероприятию — прежний текст и кнопка', async () => {
    const { ids, typeId } = await yard(['2099-07-09', '2099-07-10']);
    await asManager(async (tx) => saveEventType(tx, { id: typeId, name: 'Двор', slots: await slotsFor(tx, { 'ЗАЛ': 2 }) }));
    await testSql`delete from tg_event`;
    await asManager((tx) => applyEventTemplate(tx, ids[1], '2099-07-08'));
    await asManager((tx) => processEvents(tx, now, o));
    const rows = await sent();
    expect(rows.map((r) => r.chat).sort()).toEqual([101, 102]);
    for (const r of rows) {
      expect(r.text).toBe('🙋 <b>Нужен человек</b>\n🗓 Пт, 10\u00a0июля\n🕕 Начало 11:00\n🎵 Концерт 2\n💰 1\u00a0300\u00a0₽\nСвободно мест: 2');
      expect(r.markup).toEqual({ inline_keyboard: [[btn('Записаться', { op: 'su', eventId: ids[1] })], [login('/available')]] });
    }
  });

  it('после сводки правило «раз в 6 часов» действует для каждого её мероприятия', async () => {
    const { ids, grow } = await yard(['2099-07-09', '2099-07-10', '2099-07-11']);
    await grow(2);
    await asManager((tx) => processEvents(tx, now, o));
    expect(await sent()).toHaveLength(2);

    await grow(3);
    await asManager((tx) => processEvents(tx, now, o));
    expect(await sent()).toHaveLength(2);

    // По второму мероприятию 6 часов прошли, по остальным — нет.
    await testSql`update tg_outbox set created_at = created_at - interval '7 hours' where dedupe_key like ${`free:${ids[1]}:%`}`;
    await grow(4);
    await asManager((tx) => processEvents(tx, now, o));
    const fresh = (await sent()).slice(2);
    expect(fresh.map((r) => r.chat).sort()).toEqual([101, 102]);
    for (const r of fresh) expect(r.text).toBe('🙋 <b>Нужен человек</b>\n🗓 Пт, 10\u00a0июля\n🕕 Начало 11:00\n🎵 Концерт 2\n💰 1\u00a0300\u00a0₽\nСвободно мест: 4');
  });

  it('в сводку не попадают черновик, прошедшее и дальше 7 дней', async () => {
    await testSql`insert into month (month, status) values ('2099-08', 'draft')`;
    const late = new Date('2099-07-28T09:00:00Z'); // 28 июля, окно до 4 августа
    const { grow } = await yard(['2099-07-27', '2099-07-29', '2099-07-30', '2099-08-01', '2099-08-10']);
    expect((await grow(2, '2099-07-01')).applied).toBe(5);
    await asManager((tx) => processEvents(tx, late, o));
    const rows = await sent();
    expect(rows.map((r) => r.chat).sort()).toEqual([101, 102]);
    expect(rows[0].text).toBe([
      '🙋 <b>Нужны люди</b>',
      '• Ср, 29\u00a0июля, 11:00 — Концерт 2: 2\u00a0места · 1\u00a0300\u00a0₽',
      '• Чт, 30\u00a0июля, 12:00 — Концерт 3: 2\u00a0места · 1\u00a0300\u00a0₽',
    ].join('\n'));
    expect(await pending()).toHaveLength(0);
  });
});

describe('напоминания и нехватка', () => {
  it('за 3 часа до прихода — один раз', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    const at = new Date('2099-07-10T12:30:00Z'); // 15:30 МСК, приход 18:00
    await asManager((tx) => enqueueReminders(tx, at, o));
    await asManager((tx) => enqueueReminders(tx, at, o));
    const rows = await outbox();
    expect(rows.filter(([c, t]) => c === 101 && t.startsWith('⏰ <b>Через 3\u00a0часа смена</b>'))).toHaveLength(1);
  });

  it('накануне в 18:00 — «Завтра смена», один раз; выключено — нет', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall}), (${pol}, ${ev}, ${hall})`;
    await testSql`update telegram_link set prefs = '{"evening": "off"}' where chat_id = 102`;
    const at = new Date('2099-07-09T15:10:00Z'); // 18:10 МСК накануне
    await asManager((tx) => enqueueReminders(tx, at, o));
    await asManager((tx) => enqueueReminders(tx, new Date('2099-07-09T15:40:00Z'), o));
    expect(await outbox()).toEqual([[101, '⏰ <b>Завтра смена</b>\n🗓 Пт, 10\u00a0июля\n🕕 Приход 18:00 · начало 20:00\n🎵 Лунный свет\n👤 ЗАЛ']]);
  });

  it('нехватка — менеджеру в 12 часов, раз в день', async () => {
    await asManager((tx) => enqueueUnderstaffed(tx, now, o));
    await asManager((tx) => enqueueUnderstaffed(tx, now, o));
    await asManager((tx) => enqueueUnderstaffed(tx, new Date('2099-07-08T10:00:00Z'), o));
    const rows = await outbox();
    expect(rows.filter(([c, t]) => c === 900 && t === '⚠️ <b>Не хватает людей</b>\n• Пт, 10\u00a0июля, 20:00 — Лунный свет: 2\u00a0места')).toHaveLength(1);
    expect(await markupOf(900, '⚠️ <b>Не хватает людей')).toEqual({ inline_keyboard: [[link(`/event/${ev}`, 'пт, 10\u00a0июл., 20:00')]] });
  });
});

const ok = (result: object | boolean = {}) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));
const outboxState = async () => (await testSql`
  select chat_id, sent_at is not null as sent, attempts, last_error,
    extract(epoch from send_after - now())::int as wait from tg_outbox order by chat_id`)
  .map((r) => ({ chat: Number(r.chat_id), sent: r.sent as boolean, attempts: r.attempts as number, error: r.last_error as string | null, wait: r.wait as number }));

describe('deliverDue', () => {
  it('успех, блокировка бота, сетевая ошибка — с отсрочкой', async () => {
    await testSql`insert into tg_outbox (chat_id, text) values (1, 'a'), (2, 'b'), (3, 'c')`;
    const fake: typeof fetch = async (_url, init) => {
      const body = bodyOf(init);
      if (body.chat_id === 1) return ok();
      if (body.chat_id === 2) return new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked' }), { status: 403 });
      throw new Error('network');
    };
    const res = await deliverDue(asManager, telegramApi('TEST', fake), { limit: 10 });
    expect(res).toEqual({ sent: 1, failed: 2 });
    const rows = await outboxState();
    expect(rows.map((r) => [r.chat, r.sent, r.attempts])).toEqual([[1, true, 0], [2, false, 5], [3, false, 1]]);
    // 2^0 минут после первой ошибки.
    expect(rows[2].wait).toBeGreaterThanOrEqual(55);
    expect(rows[2].wait).toBeLessThanOrEqual(60);
  });

  it('вторая ошибка — отсрочка 2 минуты', async () => {
    await testSql`insert into tg_outbox (chat_id, text, attempts) values (3, 'c', 1)`;
    const fake: typeof fetch = async () => new Response(JSON.stringify({ ok: false, description: 'Bad Gateway' }), { status: 502 });
    await deliverDue(asManager, telegramApi('TEST', fake), { limit: 10 });
    const [row] = await outboxState();
    expect([row.attempts, row.error]).toEqual([2, '502 Bad Gateway']);
    expect(row.wait).toBeGreaterThanOrEqual(115);
    expect(row.wait).toBeLessThanOrEqual(120);
  });

  it('429 — ждать retry_after, попытку не считать, остановить пачку', async () => {
    await testSql`insert into tg_outbox (chat_id, text) values (1, 'a'), (2, 'b'), (3, 'c')`;
    const calls: number[] = [];
    const fake: typeof fetch = async (_url, init) => {
      const body = bodyOf(init);
      calls.push(body.chat_id);
      if (body.chat_id === 1) return ok();
      return new Response(JSON.stringify({ ok: false, description: 'Too Many Requests: retry after 30', parameters: { retry_after: 30 } }), { status: 429 });
    };
    expect(await deliverDue(asManager, telegramApi('TEST', fake), { limit: 10 })).toEqual({ sent: 1, failed: 1 });
    expect(calls).toEqual([1, 2]);
    const rows = await outboxState();
    expect(rows.map((r) => [r.chat, r.sent, r.attempts])).toEqual([[1, true, 0], [2, false, 0], [3, false, 0]]);
    for (const r of rows.slice(1)) {
      expect(r.wait).toBeGreaterThanOrEqual(25);
      expect(r.wait).toBeLessThanOrEqual(30);
    }
  });

  it('аренда: взятое в работу не берёт второй тик; отправленное сразу записано', async () => {
    await testSql`insert into tg_outbox (chat_id, text) values (1, 'a'), (2, 'b')`;
    let second: { sent: number; failed: number } | null = null;
    let firstSeenSent = false;
    const idle: typeof fetch = async () => ok();
    const fake: typeof fetch = async (_url, init) => {
      const body = bodyOf(init);
      if (body.chat_id === 1) second = await deliverDue(asManager, telegramApi('TEST', idle), { limit: 10 });
      if (body.chat_id === 2) firstSeenSent = (await testSql`select 1 from tg_outbox where chat_id = 1 and sent_at is not null`).length === 1;
      return ok();
    };
    expect(await deliverDue(asManager, telegramApi('TEST', fake), { limit: 10 })).toEqual({ sent: 2, failed: 0 });
    expect(second).toEqual({ sent: 0, failed: 0 });
    expect(firstSeenSent).toBe(true);
  });

  it('разметка не разобралась (старый текст в очереди) — отправлено без тегов, строка отмечена отправленной', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await testSql`insert into tg_outbox (chat_id, text) values (1, 'Заявка: A <b & C')`;
    const bodies: Array<Record<string, unknown>> = [];
    const fake: typeof fetch = async (_url, init) => {
      const body = bodyOf(init);
      bodies.push(body);
      return body.parse_mode
        ? new Response(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities: Unclosed start tag" }), { status: 400 })
        : ok();
    };
    expect(await deliverDue(asManager, telegramApi('TEST', fake), { limit: 10 })).toEqual({ sent: 1, failed: 0 });
    expect(bodies.map((b) => [b.parse_mode ?? null, b.text])).toEqual([['HTML', 'Заявка: A <b & C'], [null, 'Заявка: A <b & C']]);
    expect((await outboxState())[0]).toMatchObject({ sent: true, attempts: 0 });
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/Заявка|TEST/);
    error.mockRestore();
  });

  it('время вышло — остаток возвращается в очередь', async () => {
    await testSql`insert into tg_outbox (chat_id, text) values (1, 'a'), (2, 'b')`;
    const calls: number[] = [];
    const fake: typeof fetch = async (_url, init) => { calls.push(bodyOf(init).chat_id); return ok(); };
    expect(await deliverDue(asManager, telegramApi('TEST', fake), { limit: 10, budgetMs: 0 })).toEqual({ sent: 0, failed: 0 });
    expect(calls).toEqual([]);
    expect(await deliverDue(asManager, telegramApi('TEST', fake), { limit: 10 })).toEqual({ sent: 2, failed: 0 });
  });
});

describe('api и config', () => {
  it('ошибка сети — status 0, ключ не попадает в описание; запрос с таймаутом', async () => {
    let signal: AbortSignal | null | undefined;
    const fake: typeof fetch = async (url, init) => { signal = init?.signal; throw new Error(`fail ${String(url)}`); };
    const res = await telegramApi('SECRET123', fake).sendMessage(1, 'x');
    expect(res).toEqual({ ok: false, status: 0, description: 'network' });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('429 — retry_after в результате', async () => {
    const fake: typeof fetch = async () => new Response(JSON.stringify({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 7 } }), { status: 429 });
    expect(await telegramApi('T', fake).sendMessage(1, 'x')).toEqual({ ok: false, status: 429, description: 'Too Many Requests', retryAfter: 7 });
  });

  it('секрет вебхука и ссылка', () => {
    expect(webhookSecret('t')).toMatch(/^[0-9a-f]{64}$/);
    expect(webhookSecret('t')).not.toBe(webhookSecret('u'));
    expect(deepLink('abc')).toMatch(/^https:\/\/t\.me\/\w+\?start=abc$/);
  });
});

const fingerprint = (url: string, secret: string) => createHash('sha256').update(`${url}|${secret}`).digest('hex');
const webhookState = async () => (await testSql`select value from app_state where name = 'webhook'`)[0]?.value as string | undefined;

describe('бюджет тика', () => {
  it('на отправку остаётся то, что не потратили вебхук и меню, но не больше 40 с и не меньше нуля', () => {
    const now = Date.now();
    expect(deliverBudgetMs(now)).toBe(40_000);
    expect(deliverBudgetMs(now - (TICK_BUDGET_MS - 12_000))).toBeLessThanOrEqual(12_000);
    expect(deliverBudgetMs(now - (TICK_BUDGET_MS - 12_000))).toBeGreaterThan(11_000);
    expect(deliverBudgetMs(now - 2 * TICK_BUDGET_MS)).toBe(0);
  });
});

describe('ensureWebhook и runTick', () => {
  it('вебхук регистрируется один раз на адрес и секрет; новый секрет — заново', async () => {
    const methods: string[] = [];
    const fake: typeof fetch = async (url, init) => {
      methods.push(String(url).split('/').pop() ?? '');
      expect(bodyOf(init).url).toBe(`${o}/api/telegram/webhook`);
      return ok(true);
    };
    const api = telegramApi('TEST', fake);
    await ensureWebhook(asManager, api, o, 's');
    await ensureWebhook(asManager, api, o, 's');
    expect(methods).toEqual(['setWebhook']);
    expect(await webhookState()).toBe(fingerprint(`${o}/api/telegram/webhook`, 's'));
    await ensureWebhook(asManager, api, o, 's2');
    expect(methods).toEqual(['setWebhook', 'setWebhook']);
  });

  it('ошибка setWebhook — отпечаток не записан, следующий тик пробует снова', async () => {
    let calls = 0;
    const fake: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: false, description: 'bad url' }), { status: 400 });
    };
    await ensureWebhook(asManager, telegramApi('TEST', fake), o, 's');
    await ensureWebhook(asManager, telegramApi('TEST', fake), o, 's');
    expect(calls).toBe(2);
    expect(await webhookState()).toBeUndefined();
  });

  it('обрабатывает, отправляет и чистит старое; залежавшееся не отправляет', async () => {
    await testSql`insert into tg_event (kind, created_at, processed_at) values ('published', now() - interval '40 days', now() - interval '31 days')`;
    await testSql`insert into tg_event (kind, created_at, processed_at) values ('published', now() - interval '2 days', now() - interval '1 day')`;
    await testSql`insert into tg_outbox (chat_id, text, sent_at) values (5, 'old', now() - interval '31 days'), (6, 'new', now() - interval '1 day')`;
    await testSql`insert into tg_outbox (chat_id, text, created_at) values (7, 'stale', now() - interval '25 hours')`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    const sentTo: number[] = [];
    const fake: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/sendMessage')) sentTo.push(bodyOf(init).chat_id);
      return ok(true);
    };
    const res = await runTick({ now: new Date(), origin: o, api: telegramApi('TEST', fake), secret: 's', db: asManager });
    expect(res).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(sentTo).toEqual([101]);
    expect((await testSql`select chat_id from tg_outbox where sent_at is not null order by chat_id`).map((r) => Number(r.chat_id)))
      .toEqual([6, 101]);
    expect((await outboxState()).find((r) => r.chat === 7)).toMatchObject({ sent: false, attempts: 5, error: 'expired' });
    expect(await testSql`select 1 from tg_event`).toHaveLength(2);
    expect(await testSql`select 1 from tg_event where processed_at < now() - interval '30 days'`).toHaveLength(0);
    expect(await webhookState()).toBe(fingerprint(`${o}/api/telegram/webhook`, 's'));
  });

  it('без ключа бота — только обработка', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    const res = await runTick({ now: new Date(now.getTime() + 3_600_000), origin: o, api: null, secret: null, db: asManager });
    expect(res).toEqual({ processed: 1, sent: 0, failed: 0 });
    expect(await outbox()).toHaveLength(1);
  });
});

const btn = (text: string, cb: Callback) => ({ text, callback_data: encodeCallback(cb) });
const markupOf = async (chatId: number, prefix: string) => {
  const rows = await testSql`select text, reply_markup from tg_outbox where chat_id = ${chatId} order by id`;
  const row = rows.find((r) => (r.text as string).startsWith(prefix));
  if (!row) throw new Error(`нет сообщения «${prefix}…» для ${chatId}`);
  return row.reply_markup;
};

describe('кнопки в уведомлениях', () => {
  it('назначение — «Не смогу», свободное место — «Записаться»', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`insert into tg_event (kind, event_id) values ('free_place', ${ev})`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await markupOf(101, '✅ <b>Вас поставили')).toEqual({ inline_keyboard: [[btn('Не смогу', { op: 'cx', eventId: ev })], [login('/shifts')]] });
    expect(await markupOf(102, '🙋 <b>Нужен человек')).toEqual({ inline_keyboard: [[btn('Записаться', { op: 'su', eventId: ev })], [login('/available')]] });
  });

  it('заявка — «Принять · <должность>» по свободным должностям и «Отклонить»; мест по должностям нет — «Принять»', async () => {
    const [{ id: box }] = await testSql`select id from position where name = 'КАССА'`;
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${ev}, ${box}, 1)`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${box})`;
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    const [{ id: sid }] = await testSql`select id from signup where worker_id = ${pol} and event_id = ${ev}`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await markupOf(900, '📥 <b>Новая заявка')).toEqual({ inline_keyboard: [
      [btn('Принять · ЗАЛ', { op: 'ma', signupId: sid, positionId: hall })],
      [btn('Отклонить', { op: 'mr', signupId: sid })],
      [link(`/event/${ev}`)],
    ] });

    await testSql`delete from tg_outbox`;
    const [{ id: e2 }] = await testSql`insert into event (event_date, start_time, concert)
      values ('2099-07-11', '19:00', 'Орган') returning id`;
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${e2})`;
    const [{ id: sid2 }] = await testSql`select id from signup where worker_id = ${pol} and event_id = ${e2}`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await markupOf(900, '📥 <b>Новая заявка')).toEqual({ inline_keyboard: [
      [btn('Принять', { op: 'ma', signupId: sid2, positionId: null })],
      [btn('Отклонить', { op: 'mr', signupId: sid2 })],
      [link(`/event/${e2}`)],
    ] });
  });

  it('заявку отозвали до обработки — сообщения о ней нет вовсе (M3 ревью безопасности)', async () => {
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    await testSql`delete from signup where worker_id = ${pol}`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await testSql`select 1 from tg_outbox where chat_id = 900 and text like '📥%'`).toHaveLength(0);
  });

  it('«Не сможет выйти» — «Отпустить» и «Оставить» одной строкой', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`delete from tg_event`;
    await testSql`update assignment set cancel_requested_at = now() where worker_id = ${ian}`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await markupOf(900, '⚠️ <b>Не сможет выйти')).toEqual({ inline_keyboard: [[
      btn('Отпустить', { op: 'mo', eventId: ev, workerId: ian }),
      btn('Оставить', { op: 'mk', eventId: ev, workerId: ian }),
    ], [link(`/event/${ev}`)]] });
  });

  it('напоминания — «Не смогу»; отправка передаёт клавиатуру в Telegram', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await asManager((tx) => enqueueReminders(tx, new Date('2099-07-09T15:10:00Z'), o)); // 18:10 накануне
    await asManager((tx) => enqueueReminders(tx, new Date('2099-07-10T12:30:00Z'), o)); // за 3 часа
    const cancel = { inline_keyboard: [[btn('Не смогу', { op: 'cx', eventId: ev })], [login('/shifts')]] };
    expect(await markupOf(101, '⏰ <b>Завтра смена')).toEqual(cancel);
    expect(await markupOf(101, '⏰ <b>Через 3')).toEqual(cancel);
    const bodies: Array<Record<string, unknown>> = [];
    const fake: typeof fetch = async (_url, init) => { bodies.push(bodyOf(init)); return ok(); };
    await deliverDue(asManager, telegramApi('TEST', fake), { limit: 10 });
    expect(bodies.map((b) => b.reply_markup)).toEqual([cancel, cancel]);
  });

  it('напоминание работнику, который уже запросил отмену, — без «Не смогу», только ссылка', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id, cancel_requested_at) values (${ian}, ${ev}, ${hall}, now())`;
    await asManager((tx) => enqueueReminders(tx, new Date('2099-07-09T15:10:00Z'), o));
    expect(await markupOf(101, '⏰ <b>Завтра смена')).toEqual({ inline_keyboard: [[login('/shifts')]] });
  });

  it('уведомления без кнопок действий (решение по заявке) — только ссылка; не https — reply_markup пустой', async () => {
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    await testSql`delete from tg_event`;
    await testSql`update signup set status = 'rejected' where worker_id = ${pol}`;
    await asManager((tx) => processEvents(tx, now, o));
    expect(await markupOf(102, '🙅 <b>Заявку отклонили')).toEqual({ inline_keyboard: [[login('/available')]] });
    await testSql`delete from tg_outbox`;
    await testSql`update signup set status = 'pending' where worker_id = ${pol}`;
    await testSql`delete from tg_event`;
    await testSql`update signup set status = 'rejected' where worker_id = ${pol}`;
    await asManager((tx) => processEvents(tx, now, 'http://localhost:3000'));
    expect(await markupOf(102, '🙅 <b>Заявку отклонили')).toBeNull();
  });
});
