import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { asAppAnon, asManager, asWorker, resetTestDb, testSql } from './setup';
import { issueToken } from '@/app/(manager)/workers/operations';
import { redeemWorkerLoginCode, workerBySession } from '@/lib/auth/workerSession';
import { botDeps, fakeApi, type ApiCall } from './telegramFakes';
import { handleCallback } from '@/lib/telegram/buttons';
import { handleUpdate } from '@/lib/telegram/bot';
import type { BotDeps } from '@/lib/telegram/bot';
import { encodeCallback, packId, type Callback } from '@/lib/telegram/callbacks';
import type { Keyboard } from '@/lib/telegram/keyboards';

let ian: string; let pol: string; let ev: string; let hall: string; let draft: string;
const TEXT = '🙋 <b>Нужен человек</b>\n🎵 Лунный свет';
const LINK = { text: 'Открыть в приложении', url: 'https://a.app/available' };

beforeEach(async () => {
  await resetTestDb();
  [{ id: ian }] = await testSql`insert into worker (full_name, name_key) values ('Ян', 'ян') returning id`;
  [{ id: pol }] = await testSql`insert into worker (full_name, name_key) values ('Полина', 'полина') returning id`;
  [{ id: hall }] = await testSql`select id from position where name = 'ЗАЛ'`;
  [{ id: ev }] = await testSql`insert into event (event_date, start_time, arrive_time, concert)
    values ('2099-07-10', '20:00', '18:00', 'Лунный свет') returning id`;
  await testSql`insert into event_slot (event_id, position_id, quantity) values (${ev}, ${hall}, 2)`;
  await testSql`insert into month (month, status) values ('2099-08', 'draft')`;
  [{ id: draft }] = await testSql`insert into event (event_date, start_time) values ('2099-08-05', '20:00') returning id`;
  await testSql`insert into telegram_link (worker_id, chat_id) values (${ian}, 101), (${pol}, 102), (null, 900)`;
});

afterEach(() => { vi.restoreAllMocks(); });

const btn = (text: string, cb: Callback) => ({ text, callback_data: encodeCallback(cb) });

async function press(
  chatId: number, cb: Callback | string,
  opts: { html?: string | null; keyboard?: Keyboard | null; deps?: Partial<BotDeps>; fail?: (c: ApiCall) => boolean } = {},
) {
  const { api, calls } = fakeApi(opts.fail);
  const revalidate = vi.fn();
  await handleCallback(botDeps(api, { revalidate, ...opts.deps }), {
    kind: 'callback', chatId, messageId: 7, callbackId: 'q1',
    data: typeof cb === 'string' ? cb : encodeCallback(cb),
    html: opts.html === undefined ? TEXT : opts.html,
    keyboard: opts.keyboard ?? null,
  });
  const answers = calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.body);
  const edits = calls.filter((c) => c.method === 'editMessageText').map((c) => c.body);
  // На каждое нажатие — ровно один ответ, иначе у кнопки крутится индикатор.
  expect(answers).toHaveLength(1);
  expect(edits.length).toBeLessThanOrEqual(1);
  return { answer: answers[0], edit: edits[0] ?? null, revalidate };
}

const signupStatus = async (workerId: string, eventId: string) =>
  ((await testSql`select status::text as s from signup where worker_id = ${workerId} and event_id = ${eventId}`)[0]?.s as string | undefined) ?? null;
const assignment = async (workerId: string, eventId: string) =>
  (await testSql`select position_id, cancel_requested_at is not null as cancel from assignment
    where worker_id = ${workerId} and event_id = ${eventId}`)[0] ?? null;
const paths = (eventId: string) => ['/shifts', '/available', '/month', `/event/${eventId}`];

describe('права и мусор', () => {
  it('неподключённый чат — подсказка, без действий', async () => {
    const r = await press(555, { op: 'su', eventId: ev });
    expect(r.answer).toMatchObject({ show_alert: true, text: expect.stringContaining('Подключитесь из приложения') });
    expect(r.edit).toBeNull();
    expect(await testSql`select 1 from signup`).toEqual([]);
  });

  it('непонятные данные — «Кнопка устарела»', async () => {
    for (const data of ['zz:1', `su:${'A'.repeat(21)}`, `mo:${packId(ev)}`, '']) {
      const r = await press(101, data);
      expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Кнопка устарела' });
      expect(r.edit).toBeNull();
    }
  });

  it('кнопка работника из чата менеджера и наоборот — «Кнопка не для этого чата», без действий', async () => {
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    const [{ id: sid }] = await testSql`select id from signup where worker_id = ${pol}`;
    const a = await press(900, { op: 'su', eventId: ev });
    const b = await press(101, { op: 'ma', signupId: sid, positionId: hall });
    for (const r of [a, b]) {
      expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Кнопка не для этого чата' });
      expect(r.edit).toBeNull();
    }
    expect(await signupStatus(pol, ev)).toBe('pending');
    expect(await testSql`select 1 from assignment`).toEqual([]);
  });

  it('прочая ошибка — общий текст без подробностей', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    const [{ id: sid }] = await testSql`select id from signup where worker_id = ${pol}`;
    const r = await press(900, { op: 'mr', signupId: sid }, { deps: { manager: async () => { throw new Error('boom секрет'); } } });
    expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Не получилось, попробуйте в приложении', show_alert: true });
    expect(r.edit).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('устаревшие и чужие нажатия без разбора', () => {
  it('callback_invalid — «Кнопка устарела», база и правки не нужны', async () => {
    const { api, calls } = fakeApi();
    const boom = async () => { throw new Error('база не нужна'); };
    await handleUpdate(botDeps(api, { anon: boom, worker: () => boom, manager: boom }), { kind: 'callback_invalid', callbackId: 'q7' });
    expect(calls).toEqual([{ method: 'answerCallbackQuery', body: { callback_query_id: 'q7', text: 'Кнопка устарела' } }]);
  });
});

describe('сбои Telegram и обновления страниц', () => {
  it('не удалась правка сообщения — ответ уже дан, действие сохранено, обработчик не падает', async () => {
    const r = await press(102, { op: 'su', eventId: ev }, {
      keyboard: { inline_keyboard: [[btn('Записаться', { op: 'su', eventId: ev })]] },
      fail: (c) => c.method === 'editMessageText',
    });
    expect(await signupStatus(pol, ev)).toBe('pending');
    expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Заявка подана' });
    expect(r.edit).not.toBeNull();
  });

  it('не удался ответ на нажатие — правка всё равно выполняется, обработчик не падает', async () => {
    const r = await press(102, { op: 'su', eventId: ev }, {
      keyboard: { inline_keyboard: [[btn('Записаться', { op: 'su', eventId: ev })]] },
      fail: (c) => c.method === 'answerCallbackQuery',
    });
    expect(await signupStatus(pol, ev)).toBe('pending');
    expect(r.answer).toMatchObject({ text: 'Заявка подана' });
    expect(r.edit).not.toBeNull();
  });

  it('revalidate упал после записи — успех остаётся успехом, ошибка в лог без данных', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const revalidate = () => { throw new Error('секрет пути'); };
    const r = await press(102, { op: 'su', eventId: ev }, {
      keyboard: { inline_keyboard: [[btn('Записаться', { op: 'su', eventId: ev })]] },
      deps: { revalidate },
    });
    expect(await signupStatus(pol, ev)).toBe('pending');
    expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Заявка подана' });
    expect(r.edit).not.toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('секрет');
  });
});

describe('кнопки работника', () => {
  it('кнопки сообщения не разобрались — действие и ответ есть, кнопки не трогаем', async () => {
    const wrong = await press(102, { op: 'su', eventId: ev }, { keyboard: null });
    expect(await signupStatus(pol, ev)).toBe('pending');
    expect(wrong.answer).toMatchObject({ text: 'Заявка подана' });
    expect(wrong.edit).toBeNull();
    const withdraw = await press(102, { op: 'sw', eventId: ev }, { keyboard: null });
    expect(withdraw.answer).toMatchObject({ text: 'Заявка отозвана' });
    expect(withdraw.edit).toBeNull();
    for (const op of ['cx', 'cb'] as const) {
      const r = await press(102, { op, eventId: ev }, { keyboard: null });
      expect(r.answer).toEqual({ callback_query_id: 'q1' });
      expect(r.edit).toBeNull();
    }
  });

  it('«Записаться» → заявка, нажатая кнопка меняется на «Отозвать…», остальные не трогаются', async () => {
    const [{ id: e2 }] = await testSql`insert into event (event_date, start_time, concert) values ('2099-07-11', '19:00', 'Орган') returning id`;
    const keyboard: Keyboard = { inline_keyboard: [
      [btn('Записаться: пт, 10 июл.', { op: 'su', eventId: ev })],
      [btn('Записаться: сб, 11 июл.', { op: 'su', eventId: e2 })],
    ] };
    const r = await press(102, { op: 'su', eventId: ev }, { keyboard });
    expect(await signupStatus(pol, ev)).toBe('pending');
    expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Заявка подана' });
    expect(r.edit).toEqual({
      chat_id: 102, message_id: 7, text: TEXT, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [
        [btn('Отозвать: пт, 10 июл.', { op: 'sw', eventId: ev })],
        keyboard.inline_keyboard[1],
      ] },
    });
    expect(r.revalidate).toHaveBeenCalledWith(paths(ev));
  });

  it('«Отозвать заявку» → заявки нет, кнопка снова «Записаться»; повторный отзыв — ошибка домена окном', async () => {
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    const keyboard: Keyboard = { inline_keyboard: [[btn('Отозвать заявку', { op: 'sw', eventId: ev })]] };
    const r = await press(102, { op: 'sw', eventId: ev }, { keyboard });
    expect(await signupStatus(pol, ev)).toBeNull();
    expect(r.answer).toMatchObject({ text: 'Заявка отозвана' });
    expect(r.edit?.reply_markup).toEqual({ inline_keyboard: [[btn('Записаться', { op: 'su', eventId: ev })]] });

    const again = await press(102, { op: 'sw', eventId: ev }, { keyboard });
    expect(again.answer).toEqual({ callback_query_id: 'q1', text: 'Заявки нет — обновите страницу', show_alert: true });
    expect(again.edit).toBeNull();
  });

  it('чужое (черновое) мероприятие — ошибка домена окном, заявки нет', async () => {
    const r = await press(102, { op: 'su', eventId: draft });
    expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Событие уже прошло или вы уже на нём', show_alert: true });
    expect(r.edit).toBeNull();
    expect(r.revalidate).not.toHaveBeenCalled();
    expect(await signupStatus(pol, draft)).toBeNull();
  });

  it('«Не смогу» → подтверждение → «Назад»: без записи в базу', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    const start: Keyboard = { inline_keyboard: [[btn('Не смогу', { op: 'cx', eventId: ev })]] };
    const step1 = await press(101, { op: 'cx', eventId: ev }, { keyboard: start });
    expect(step1.answer).toEqual({ callback_query_id: 'q1' });
    const confirm = { inline_keyboard: [[btn('Да, не смогу', { op: 'cy', eventId: ev }), btn('Назад', { op: 'cb', eventId: ev })]] };
    expect(step1.edit?.reply_markup).toEqual(confirm);
    const back = await press(101, { op: 'cb', eventId: ev }, { keyboard: confirm });
    expect(back.edit?.reply_markup).toEqual(start);
    expect(await assignment(ian, ev)).toMatchObject({ cancel: false });
  });

  it('«Да, не смогу» → отмена запрошена, строка в тексте, кнопки убраны', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    const r = await press(101, { op: 'cy', eventId: ev });
    expect(await assignment(ian, ev)).toMatchObject({ cancel: true });
    expect(r.answer).toMatchObject({ text: 'Запрос отправлен' });
    expect(r.edit).toMatchObject({
      text: `${TEXT}\n\n<i>Отмена запрошена — ждём решения менеджера.</i>`,
      reply_markup: { inline_keyboard: [] },
    });
    expect(r.revalidate).toHaveBeenCalledWith(paths(ev));
  });

  it('«Да, не смогу» под уведомлением со ссылкой — кнопки действий убраны, ссылка осталась', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    const html = '✅ <b>Вас поставили на смену</b>\n🎵 Rock &amp; Roll';
    const keyboard = { inline_keyboard: [[btn('Да, не смогу', { op: 'cy', eventId: ev }), btn('Назад', { op: 'cb', eventId: ev })], [LINK]] };
    const r = await press(101, { op: 'cy', eventId: ev }, { html, keyboard });
    expect(r.edit).toMatchObject({
      text: `${html}\n\n<i>Отмена запрошена — ждём решения менеджера.</i>`,
      reply_markup: { inline_keyboard: [[LINK]] },
    });
  });

  it('«Да, не смогу» по чужой смене — ошибка домена окном, ничего не меняется', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    const r = await press(102, { op: 'cy', eventId: ev });
    expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Отмена уже запрошена или смена не найдена', show_alert: true });
    expect(r.edit).toBeNull();
    expect(await assignment(ian, ev)).toMatchObject({ cancel: false });
  });

  it('нет текста сообщения — действие и ответ есть, правки нет', async () => {
    const r = await press(102, { op: 'su', eventId: ev }, { html: null });
    expect(await signupStatus(pol, ev)).toBe('pending');
    expect(r.answer).toMatchObject({ text: 'Заявка подана' });
    expect(r.edit).toBeNull();
  });
});

describe('«Не смогу» из «Моих смен»', () => {
  it('«Не смогу: <день>» → подтверждение с днём → «Да» — итог с днём, кнопки других смен и ссылка остаются', async () => {
    const [{ id: e2 }] = await testSql`insert into event (event_date, start_time, concert) values ('2099-07-11', '19:00', 'Орган') returning id`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall}), (${ian}, ${e2}, ${hall})`;
    const shifts = { text: 'Открыть в приложении', url: 'https://a.app/shifts' };
    const other = [btn('Не смогу: сб, 11 июл.', { op: 'cx', eventId: e2 })];
    const list: Keyboard = { inline_keyboard: [[btn('Не смогу: пт, 10 июл.', { op: 'cx', eventId: ev })], other, [shifts]] };
    const html = '📅 <b>Ваши ближайшие смены</b>\n\n<b>Пт, 10 июля</b>';
    const step1 = await press(101, { op: 'cx', eventId: ev }, { html, keyboard: list });
    const confirm = { inline_keyboard: [
      [btn('Да, не смогу: пт, 10 июл.', { op: 'cy', eventId: ev }), btn('Назад', { op: 'cb', eventId: ev })], other, [shifts],
    ] };
    expect(step1.edit).toMatchObject({ text: html, reply_markup: confirm });
    expect(await assignment(ian, ev)).toMatchObject({ cancel: false });

    const done = await press(101, { op: 'cy', eventId: ev }, { html, keyboard: confirm });
    expect(await assignment(ian, ev)).toMatchObject({ cancel: true });
    expect(done.answer).toMatchObject({ text: 'Запрос отправлен' });
    expect(done.edit).toMatchObject({
      text: `${html}\n\n<i>Отмена запрошена: пт, 10 июл. — ждём решения менеджера.</i>`,
      reply_markup: { inline_keyboard: [other, [shifts]] },
    });
    expect(await assignment(ian, e2)).toMatchObject({ cancel: false });
  });
});

describe('«Заработок»: переключение месяца', () => {
  it('‹ / › — то же сообщение за другой месяц, от имени владельца чата', async () => {
    await testSql`update event set base_rate = 1300 where id = ${ev}`;
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    const r = await press(101, { op: 'pm', month: '2099-07' }, { html: null });
    expect(r.answer).toEqual({ callback_query_id: 'q1' });
    expect(r.edit).toEqual({
      chat_id: 101, message_id: 7, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      text: '💰 <b>Заработок · июль</b>\n1 смена — <b>1 300 ₽</b>',
      reply_markup: { inline_keyboard: [
        [btn('‹ июнь', { op: 'pm', month: '2099-06' })],
        [{ text: 'Открыть приложение', web_app: { url: 'https://a.app/tg/app?to=%2Fearnings%3Fmonth%3D2099-07' } }],
      ] },
    });
    const june = await press(101, { op: 'pm', month: '2099-06' });
    expect(june.edit).toMatchObject({
      text: '💰 <b>Заработок · июнь</b>\n0 смен — <b>0 ₽</b>',
      reply_markup: { inline_keyboard: [[btn('‹ май', { op: 'pm', month: '2099-05' }), btn('июль ›', { op: 'pm', month: '2099-07' })], expect.anything()] },
    });
    // Чужие смены не видны: у Полины в июле ничего.
    expect((await press(102, { op: 'pm', month: '2099-07' })).edit).toMatchObject({ text: '💰 <b>Заработок · июль</b>\n0 смен — <b>0 ₽</b>' });
  });

  it('будущий месяц — «Кнопка устарела»; из чата менеджера — «Кнопка не для этого чата»', async () => {
    const future = await press(101, { op: 'pm', month: '2099-08' });
    expect(future.answer).toEqual({ callback_query_id: 'q1', text: 'Кнопка устарела' });
    expect(future.edit).toBeNull();
    const manager = await press(900, { op: 'pm', month: '2099-07' });
    expect(manager.answer).toEqual({ callback_query_id: 'q1', text: 'Кнопка не для этого чата' });
    expect(manager.edit).toBeNull();
  });
});

describe('кнопки менеджера', () => {
  let sid: string;
  beforeEach(async () => {
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    [{ id: sid }] = await testSql`select id from signup where worker_id = ${pol} and event_id = ${ev}`;
  });

  it('«Принять · ЗАЛ» → назначен, «✓ Принято: ЗАЛ.»; повтор — «Уже решено в приложении.»', async () => {
    const r = await press(900, { op: 'ma', signupId: sid, positionId: hall });
    expect(await signupStatus(pol, ev)).toBe('accepted');
    expect(await assignment(pol, ev)).toMatchObject({ position_id: hall });
    expect(r.answer).toMatchObject({ text: 'Принято' });
    expect(r.edit).toMatchObject({ text: `${TEXT}\n\n<i>✓ Принято: ЗАЛ.</i>`, reply_markup: { inline_keyboard: [] } });
    expect(r.revalidate).toHaveBeenCalledWith(paths(ev));

    const again = await press(900, { op: 'ma', signupId: sid, positionId: hall });
    expect(again.answer).toEqual({ callback_query_id: 'q1', text: 'Заявка уже обработана', show_alert: true });
    expect(again.edit).toMatchObject({ text: `${TEXT}\n\n<i>Уже решено в приложении.</i>`, reply_markup: { inline_keyboard: [] } });
  });

  it('итог менеджера: ссылка в приложение остаётся', async () => {
    const keyboard = { inline_keyboard: [[btn('Отклонить', { op: 'mr', signupId: sid })], [LINK]] };
    const r = await press(900, { op: 'mr', signupId: sid }, { keyboard });
    expect(r.edit?.reply_markup).toEqual({ inline_keyboard: [[LINK]] });
  });

  it('«Принять» без должности', async () => {
    const r = await press(900, { op: 'ma', signupId: sid, positionId: null });
    expect(await assignment(pol, ev)).toMatchObject({ position_id: null });
    expect(r.edit).toMatchObject({ text: `${TEXT}\n\n<i>✓ Принято: без должности.</i>` });
  });

  it('на должности мест нет — ошибка окном, кнопки остаются, заявка ждёт', async () => {
    const [{ id: box }] = await testSql`select id from position where name = 'КАССА'`;
    const r = await press(900, { op: 'ma', signupId: sid, positionId: box });
    expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'На этой должности мест нет — увеличьте количество', show_alert: true });
    expect(r.edit).toBeNull();
    expect(await signupStatus(pol, ev)).toBe('pending');
    expect(await assignment(pol, ev)).toBeNull();
  });

  it('«Отклонить» → «Заявка отклонена.»', async () => {
    const r = await press(900, { op: 'mr', signupId: sid });
    expect(await signupStatus(pol, ev)).toBe('rejected');
    expect(r.answer).toMatchObject({ text: 'Заявка отклонена' });
    expect(r.edit).toMatchObject({ text: `${TEXT}\n\n<i>Заявка отклонена.</i>`, reply_markup: { inline_keyboard: [] } });
    expect(r.revalidate).toHaveBeenCalledWith(paths(ev));

    const again = await press(900, { op: 'mr', signupId: sid });
    expect(again.answer).toEqual({ callback_query_id: 'q1', text: 'Заявка уже обработана', show_alert: true });
    expect(again.edit).toMatchObject({ text: `${TEXT}\n\n<i>Уже решено в приложении.</i>`, reply_markup: { inline_keyboard: [] } });
    expect(await signupStatus(pol, ev)).toBe('rejected');
  });

  it('«Отпустить» / «Оставить» из чата работника — «Кнопка не для этого чата», без действий', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id, cancel_requested_at)
      values (${ian}, ${ev}, ${hall}, now())`;
    for (const op of ['mo', 'mk'] as const) {
      const r = await press(102, { op, eventId: ev, workerId: ian });
      expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Кнопка не для этого чата' });
      expect(r.edit).toBeNull();
    }
    expect(await assignment(ian, ev)).toMatchObject({ cancel: true });
  });

  it('«Оставить», когда человека уже нет, — «Уже решено в приложении.»', async () => {
    const r = await press(900, { op: 'mk', eventId: ev, workerId: ian });
    expect(r.answer).toMatchObject({ show_alert: true });
    expect(r.edit).toMatchObject({ text: `${TEXT}\n\n<i>Уже решено в приложении.</i>`, reply_markup: { inline_keyboard: [] } });
    expect(r.revalidate).not.toHaveBeenCalled();
  });

  it('«Отпустить» / «Оставить» — только пока отмена запрошена', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id, cancel_requested_at)
      values (${ian}, ${ev}, ${hall}, now())`;
    const keep = await press(900, { op: 'mk', eventId: ev, workerId: ian });
    expect(await assignment(ian, ev)).toMatchObject({ cancel: false });
    expect(keep.edit).toMatchObject({ text: `${TEXT}\n\n<i>Оставили на смене.</i>`, reply_markup: { inline_keyboard: [] } });

    // Отмену уже рассмотрели — устаревшая «Отпустить» человека не снимает.
    const stale = await press(900, { op: 'mo', eventId: ev, workerId: ian });
    expect(stale.answer).toMatchObject({ show_alert: true });
    expect(stale.edit).toMatchObject({ text: `${TEXT}\n\n<i>Уже решено в приложении.</i>` });
    expect(await assignment(ian, ev)).not.toBeNull();

    await testSql`update assignment set cancel_requested_at = now() where worker_id = ${ian}`;
    const release = await press(900, { op: 'mo', eventId: ev, workerId: ian });
    expect(await assignment(ian, ev)).toBeNull();
    expect(release.answer).toMatchObject({ text: 'Отпустили' });
    expect(release.edit).toMatchObject({ text: `${TEXT}\n\n<i>Отпустили.</i>` });
    expect(release.revalidate).toHaveBeenCalledWith(paths(ev));
  });
});

describe('«Открыть приложение» (lo): одноразовая ссылка для входа', () => {
  const sent = (calls: ApiCall[]) => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body);
  const LOGIN_URL = /^https:\/\/a\.app\/tg\/([A-Za-z0-9_-]{43})\?to=(.+)$/;

  async function pressLogin(chatId: number, cb: Callback | string, deps: Partial<BotDeps> = {}) {
    const { api, calls } = fakeApi();
    await handleCallback(botDeps(api, deps), {
      kind: 'callback', chatId, messageId: 7, callbackId: 'q1',
      data: typeof cb === 'string' ? cb : encodeCallback(cb), html: TEXT, keyboard: null,
    });
    const answers = calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.body);
    expect(answers).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'editMessageText')).toEqual([]);
    return { answer: answers[0], messages: sent(calls) };
  }

  it('работник: сообщение «🔑 Ссылка для входа…» с URL-кнопкой /tg/<код>?to=<путь>, ответ «Ссылка отправлена»; ссылка входит как он', async () => {
    const r = await pressLogin(101, { op: 'lo', to: '/earnings?month=2099-07' });
    expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Ссылка отправлена' });
    expect(r.messages).toHaveLength(1);
    const [m] = r.messages;
    expect(m).toMatchObject({ chat_id: 101, parse_mode: 'HTML', text: '🔑 Ссылка для входа (действует 15 минут, одноразовая)' });
    // Ссылку для входа нельзя переслать или сохранить (L5).
    expect(m.protect_content).toBe(true);
    const button = (m.reply_markup as Keyboard).inline_keyboard[0][0] as { text: string; url: string };
    expect(button.text).toBe('Войти в приложение');
    const [, code, to] = LOGIN_URL.exec(button.url) ?? [];
    expect(decodeURIComponent(to)).toBe('/earnings?month=2099-07');
    const session = await asAppAnon((tx) => redeemWorkerLoginCode(tx, code));
    expect(await asAppAnon((tx) => workerBySession(tx, session ?? ''))).toEqual({ id: ian, fullName: 'Ян' });
  });

  it('без пути — /shifts', async () => {
    const r = await pressLogin(102, 'lo');
    const button = (r.messages[0].reply_markup as Keyboard).inline_keyboard[0][0] as { url: string };
    expect(decodeURIComponent(LOGIN_URL.exec(button.url)?.[2] ?? '')).toBe('/shifts');
  });

  it('перевыпуск ссылки между чтением владельца чата и выдачей не даёт отключённому чату новый вход', async () => {
    const result = await pressLogin(101, 'lo', {
      worker: workerId => async fn => {
        await asManager(tx => issueToken(tx, workerId));
        return asWorker(workerId, fn);
      },
    });
    expect(result.messages).toEqual([]);
    expect(await testSql`select 1 from worker_login_code`).toEqual([]);
  });

  it('повторное нажатие раньше 30 секунд — без новой ссылки, прежняя действует', async () => {
    const first = await pressLogin(101, 'lo');
    const again = await pressLogin(101, 'lo:a');
    expect(again.answer).toEqual({ callback_query_id: 'q1', text: 'Ссылку только что отправили — новая будет доступна через 30 секунд', show_alert: true });
    expect(again.messages).toEqual([]);
    const url = ((first.messages[0].reply_markup as Keyboard).inline_keyboard[0][0] as { url: string }).url;
    expect(await asAppAnon((tx) => redeemWorkerLoginCode(tx, LOGIN_URL.exec(url)?.[1] ?? ''))).not.toBeNull();
  });

  it('чат менеджера кода не получает — «Кнопка не для этого чата»', async () => {
    const r = await pressLogin(900, 'lo');
    expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Кнопка не для этого чата' });
    expect(r.messages).toEqual([]);
    expect(await testSql`select 1 from worker_login_code`).toEqual([]);
  });

  it('неподключённый чат и чат архивного работника — подсказка, кода нет', async () => {
    await testSql`update worker set status = 'archived' where id = ${pol}`;
    for (const chat of [555, 102]) {
      const r = await pressLogin(chat, 'lo');
      expect(r.answer).toMatchObject({ show_alert: true, text: expect.stringContaining('Подключитесь из приложения') });
      expect(r.messages).toEqual([]);
    }
    expect(await testSql`select 1 from worker_login_code`).toEqual([]);
  });

  it('адрес не https (локально) — «Не получилось», код не выдаётся', async () => {
    const r = await pressLogin(101, 'lo', { origin: 'http://localhost:3000' });
    expect(r.answer).toEqual({ callback_query_id: 'q1', text: 'Не получилось, попробуйте в приложении', show_alert: true });
    expect(r.messages).toEqual([]);
    expect(await testSql`select 1 from worker_login_code`).toEqual([]);
  });

  it('Telegram не принял сообщение — «Не получилось»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, calls } = fakeApi((c) => c.method === 'sendMessage');
    await handleCallback(botDeps(api), {
      kind: 'callback', chatId: 101, messageId: 7, callbackId: 'q1', data: 'lo', html: TEXT, keyboard: null,
    });
    expect(calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.body))
      .toEqual([{ callback_query_id: 'q1', text: 'Не получилось, попробуйте в приложении', show_alert: true }]);
  });

  it('старая URL-кнопка «Открыть в приложении» под сообщением сохраняется при нажатии действий', async () => {
    const r = await press(102, { op: 'su', eventId: ev }, {
      keyboard: { inline_keyboard: [[btn('Записаться', { op: 'su', eventId: ev })], [LINK]] },
    });
    expect(r.edit).toMatchObject({ reply_markup: { inline_keyboard: [[btn('Отозвать заявку', { op: 'sw', eventId: ev })], [LINK]] } });
  });
});
