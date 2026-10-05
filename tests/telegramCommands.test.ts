import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetTestDb, testSql } from './setup';
import { telegramApi } from '@/lib/telegram/api';
import { botDeps, fakeApi, ORIGIN as o } from './telegramFakes';
import {
  freeReply, handleText, helpReply, monthLabel, parseCommand, payReply, settingsReply, shiftsReply,
} from '@/lib/telegram/commands';
import { MANAGER_COMMANDS, menuKeyboard, WORKER_COMMANDS } from '@/lib/telegram/menu';
import { encodeCallback, type Callback } from '@/lib/telegram/callbacks';
import type { BotDeps } from '@/lib/telegram/bot';

const btn = (text: string, cb: Callback) => ({ text, callback_data: encodeCallback(cb) });
const link = (path: string, text = 'Открыть в приложении') => ({ text, url: `${o}${path}` });
/** Работнику — кнопка Mini App «Открыть приложение» (вход по initData на /tg/app). */
const login = (to: string, text = 'Открыть приложение') => ({ text, web_app: { url: `${o}/tg/app?${new URLSearchParams({ to })}` } });
const HELP = '❓ <b>Помощь</b>\nВыберите действие в меню внизу чата или отправьте команду:\n';
const WORKER_HELP = `${HELP}/shifts — мои смены\n/free — свободные места\n/pay — заработок\n/settings — настройки уведомлений\n/help — помощь`;
const MANAGER_HELP = `${HELP}/requests — заявки и отмены\n/understaffed — нехватка людей\n/settings — настройки уведомлений\n/help — помощь`;
const SETTINGS = '⚙️ <b>Настройки</b>\nКакие уведомления присылать и когда напоминать — настраивается в приложении.';

describe('разбор команд и тексты (без базы)', () => {
  it('parseCommand', () => {
    expect(parseCommand('/shifts')).toBe('shifts');
    expect(parseCommand('/Shifts@DemoShiftsBot лишнее')).toBe('shifts');
    expect(parseCommand('  /pay  ')).toBe('pay');
    expect(parseCommand('/free@demoshiftsbot')).toBe('free');
    expect(parseCommand('/shifts@OtherBot')).toBeNull();
    expect(parseCommand('привет')).toBeNull();
    expect(parseCommand('shifts')).toBeNull();
    expect(parseCommand('/')).toBeNull();
  });

  it('помощь — из списков меню; настройки — кнопкой', () => {
    expect(helpReply(WORKER_COMMANDS)).toBe(WORKER_HELP);
    expect(helpReply(MANAGER_COMMANDS)).toBe(MANAGER_HELP);
    expect(settingsReply(o, '/notifications')).toEqual({
      text: SETTINGS, keyboard: { inline_keyboard: [[login('/notifications', 'Открыть настройки')]] },
    });
    expect(settingsReply('http://localhost:3000', '/telegram')).toEqual({ text: SETTINGS, keyboard: null });
  });

  it('«Мои смены»: блок на смену, до 10; пусто — «Ближайших смен нет.»; текст из базы экранирован', () => {
    const shift = {
      eventId: 'e', date: '2099-07-10', startTime: '20:00', arriveTime: '18:00', concert: 'Лунный свет',
      position: 'БИЛЕТЫ', amount: null, cancelRequested: false,
    };
    const two = shiftsReply([shift, { ...shift, date: '2099-07-11', arriveTime: null, concert: 'A & <B>', position: null, cancelRequested: true }], o);
    expect(two.text).toBe(
      '📅 <b>Ваши ближайшие смены</b>\n\n'
      + '<b>Пт, 10 июля</b>\n🕕 Приход 18:00 · начало 20:00\n🎵 Лунный свет\n👤 БИЛЕТЫ\n\n'
      + '<b>Сб, 11 июля</b>\n🕕 Начало 20:00\n🎵 A &amp; &lt;B&gt;\n👤 Без должности\n<i>Отмена запрошена</i>',
    );
    // «Не смогу» — только у смены без запрошенной отмены.
    expect(two.keyboard).toEqual({ inline_keyboard: [[btn('Не смогу: пт, 10 июл.', { op: 'cx', eventId: 'e' })], [login('/shifts')]] });
    expect(shiftsReply(Array.from({ length: 12 }, () => shift), o).text.split('\n\n')).toHaveLength(11);
    expect(shiftsReply([], o)).toEqual({ text: '📅 <b>Ваши ближайшие смены</b>\nБлижайших смен нет.', keyboard: { inline_keyboard: [[login('/shifts')]] } });
  });

  it('«Мои смены»: «Не смогу: <день>» — до 5 ближайших; две смены в один день — со временем', () => {
    const ids = ['0b7e0c3e-8f2a-4b7c-9d1e-2f3a4b5c6d7e', 'ffffffff-ffff-4fff-bfff-ffffffffffff', '00000000-0000-4000-8000-000000000001'];
    const shift = (i: number, date: string, startTime = '20:00') => ({
      eventId: ids[i % 3], date, startTime, arriveTime: null, concert: null, position: null, amount: null, cancelRequested: false,
    });
    const twin = shiftsReply([shift(0, '2099-07-10', '12:00'), shift(1, '2099-07-10'), shift(2, '2099-07-11')], o);
    expect(twin.keyboard?.inline_keyboard.map((row) => row[0].text)).toEqual([
      'Не смогу: пт, 10 июл., 12:00', 'Не смогу: пт, 10 июл., 20:00', 'Не смогу: сб, 11 июл.', 'Открыть приложение',
    ]);
    const many = shiftsReply(Array.from({ length: 8 }, (_, i) => shift(i, `2099-07-1${i}`)), o);
    expect(many.keyboard?.inline_keyboard).toHaveLength(6);
  });

  it('«Свободные места»: до 5, кнопки «Записаться: <день>» / «Отозвать: <день>»; в один день — со временем', () => {
    const base = { eventId: '0b7e0c3e-8f2a-4b7c-9d1e-2f3a4b5c6d7e', date: '2099-07-10', startTime: '20:00', concert: 'Лунный свет', rate: null, signupStatus: null };
    const e2 = { ...base, eventId: 'ffffffff-ffff-4fff-bfff-ffffffffffff', date: '2099-07-11', startTime: '19:00', concert: 'Орган', signupStatus: 'pending' as const };
    const e3 = { ...base, eventId: '00000000-0000-4000-8000-000000000001', date: '2099-07-12', signupStatus: 'rejected' as const };
    const r = freeReply([base, e2, e3], o);
    expect(r.text).toBe(
      '🙋 <b>Свободные места</b>\n'
      + '• Пт, 10 июля, 20:00 — Лунный свет\n'
      + '• Сб, 11 июля, 19:00 — Орган · <i>заявка подана</i>\n'
      + '• Вс, 12 июля, 20:00 — Лунный свет · <i>заявку отклонили</i>',
    );
    expect(r.keyboard).toEqual({ inline_keyboard: [
      [btn('Записаться: пт, 10 июл.', { op: 'su', eventId: base.eventId })],
      [btn('Отозвать: сб, 11 июл.', { op: 'sw', eventId: e2.eventId })],
      [login('/available')],
    ] });
    const twin = { ...base, eventId: e3.eventId, startTime: '15:00', signupStatus: null };
    expect(freeReply([twin, base], o).keyboard?.inline_keyboard.slice(0, 2).map((row) => row[0].text))
      .toEqual(['Записаться: пт, 10 июл., 15:00', 'Записаться: пт, 10 июл., 20:00']);
    expect(freeReply(Array.from({ length: 7 }, () => base), o).keyboard?.inline_keyboard).toHaveLength(6);
    expect(freeReply([], o)).toEqual({ text: '🙋 <b>Свободные места</b>\nСвободных мест пока нет.', keyboard: { inline_keyboard: [[login('/available')]] } });
  });

  it('«Свободные места» со ставкой, которую получит работник (L6)', () => {
    const e = { eventId: '0b7e0c3e-8f2a-4b7c-9d1e-2f3a4b5c6d7e', date: '2099-07-10', startTime: '20:00', concert: 'Седер', rate: { min: 1500, max: 2000 }, signupStatus: 'pending' as const };
    expect(freeReply([e], o).text).toBe('🙋 <b>Свободные места</b>\n• Пт, 10\u00a0июля, 20:00 — Седер · 1\u00a0500–2\u00a0000\u00a0₽ · <i>заявка подана</i>');
  });

  it('«Заработок»: месяц без года (другой год — с годом), сумма жирным, ссылка на месяц', () => {
    expect(payReply('2099-09', '2099-09', { shifts: 6, total: 7800, unpriced: 0 }, o).text)
      .toBe('💰 <b>Заработок · сентябрь</b>\n6 смен — <b>7 800 ₽</b>');
    expect(payReply('2099-07', '2099-09', { shifts: 2, total: 1300, unpriced: 1 }, o).text)
      .toBe('💰 <b>Заработок · июль</b>\n2 смены — <b>1 300 ₽</b>\nБез ставки: 1 (уточняется).');
    expect(monthLabel('2098-12', '2099-01')).toBe('декабрь 2098');
  });

  it('«Заработок»: ‹ предыдущий месяц, следующий › — не дальше текущего; через границу года — с годом', () => {
    const e = { shifts: 0, total: 0, unpriced: 0 };
    expect(payReply('2099-07', '2099-07', e, o).keyboard).toEqual({ inline_keyboard: [
      [btn('‹ июнь', { op: 'pm', month: '2099-06' })],
      [login('/earnings?month=2099-07')],
    ] });
    expect(payReply('2099-06', '2099-07', e, o).keyboard.inline_keyboard[0]).toEqual([
      btn('‹ май', { op: 'pm', month: '2099-05' }), btn('июль ›', { op: 'pm', month: '2099-07' }),
    ]);
    expect(payReply('2099-01', '2099-02', e, o).keyboard.inline_keyboard[0]).toEqual([
      btn('‹ декабрь 2098', { op: 'pm', month: '2098-12' }), btn('февраль ›', { op: 'pm', month: '2099-02' }),
    ]);
    expect(payReply('2099-07', '2099-07', e, 'http://localhost').keyboard).toEqual({ inline_keyboard: [[btn('‹ июнь', { op: 'pm', month: '2099-06' })]] });
  });
});

describe('команды на базе', () => {
  let ian: string; let pol: string; let ev: string; let e2: string; let hall: string;

  beforeEach(async () => {
    await resetTestDb();
    [{ id: ian }] = await testSql`insert into worker (full_name, name_key) values ('Ян', 'ян') returning id`;
    [{ id: pol }] = await testSql`insert into worker (full_name, name_key) values ('Полина', 'полина') returning id`;
    [{ id: hall }] = await testSql`select id from position where name = 'ЗАЛ'`;
    [{ id: ev }] = await testSql`insert into event (event_date, start_time, arrive_time, concert, base_rate)
      values ('2099-07-10', '20:00', '18:00', 'Лунный свет', 1300) returning id`;
    [{ id: e2 }] = await testSql`insert into event (event_date, start_time, concert)
      values ('2099-07-11', '19:00', 'Орган') returning id`;
    await testSql`insert into event_slot (event_id, position_id, quantity) values (${ev}, ${hall}, 2)`;
    await testSql`insert into telegram_link (worker_id, chat_id) values (${ian}, 101), (${pol}, 102), (null, 900)`;
  });

  async function send(chatId: number, text: string, deps: Partial<BotDeps> = {}) {
    const { api, calls } = fakeApi();
    await handleText(botDeps(api, deps), chatId, text);
    expect(calls.every((c) => c.method === 'sendMessage' && c.body.chat_id === chatId)).toBe(true);
    return calls.map((c) => ({ text: c.body.text as string, markup: c.body.reply_markup ?? null }));
  }

  const WORKER_MENU = menuKeyboard(false);
  const MANAGER_MENU = menuKeyboard(true);

  it('неподключённый чат — подсказка, меню убирается', async () => {
    expect(await send(555, '/shifts')).toEqual([{ text: expect.stringContaining('Подключитесь из приложения'), markup: { remove_keyboard: true } }]);
  });

  it('/shifts, /pay — от имени работника', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id, cancel_requested_at) values (${ian}, ${ev}, ${hall}, now())`;
    await testSql`insert into assignment (worker_id, event_id) values (${ian}, ${e2})`;
    expect(await send(101, '/shifts')).toEqual([{
      text: '📅 <b>Ваши ближайшие смены</b>\n\n'
        + '<b>Пт, 10 июля</b>\n🕕 Приход 18:00 · начало 20:00\n🎵 Лунный свет\n👤 ЗАЛ\n<i>Отмена запрошена</i>\n\n'
        + '<b>Сб, 11 июля</b>\n🕕 Начало 19:00\n🎵 Орган\n👤 Без должности',
      markup: { inline_keyboard: [[btn('Не смогу: сб, 11 июл.', { op: 'cx', eventId: e2 })], [login('/shifts')]] },
    }]);
    expect(await send(102, '/shifts')).toEqual([{ text: '📅 <b>Ваши ближайшие смены</b>\nБлижайших смен нет.', markup: { inline_keyboard: [[login('/shifts')]] } }]);
    expect(await send(101, '/pay')).toEqual([{
      text: '💰 <b>Заработок · июль</b>\n2 смены — <b>1 300 ₽</b>\nБез ставки: 1 (уточняется).',
      markup: { inline_keyboard: [[btn('‹ июнь', { op: 'pm', month: '2099-06' })], [login('/earnings?month=2099-07')]] },
    }]);
  });

  it('кнопки меню — как команды; подпись без вариационного селектора тоже', async () => {
    await testSql`insert into assignment (worker_id, event_id) values (${ian}, ${e2})`;
    const [byCommand] = await send(101, '/shifts');
    expect(await send(101, '📅 Мои смены')).toEqual([byCommand]);
    expect((await send(101, '💰 Заработок'))[0].text).toMatch(/^💰 <b>Заработок · июль<\/b>/);
    expect((await send(101, '⚙️ Настройки'))[0].text).toBe(SETTINGS);
    expect((await send(101, '⚙ Настройки'))[0].text).toBe(SETTINGS);
    expect(await send(101, '❓ Помощь')).toEqual([{ text: WORKER_HELP, markup: WORKER_MENU }]);
    expect((await send(900, '📥 Заявки и отмены'))[0].text).toBe('📥 <b>Заявок и отмен нет</b>');
  });

  it('/free — «Свободные» работника с кнопками; черновик не виден', async () => {
    await testSql`insert into month (month, status) values ('2099-08', 'draft')`;
    await testSql`insert into event (event_date, start_time, concert) values ('2099-08-05', '20:00', 'Черновик')`;
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${e2})`;
    expect(await send(102, '/free')).toEqual([{
      text: '🙋 <b>Свободные места</b>\n'
        + '• Пт, 10 июля, 20:00 — Лунный свет · 1\u00a0300\u00a0₽\n'
        + '• Сб, 11 июля, 19:00 — Орган · <i>заявка подана</i>',
      markup: { inline_keyboard: [
        [btn('Записаться: пт, 10 июл.', { op: 'su', eventId: ev })],
        [btn('Отозвать: сб, 11 июл.', { op: 'sw', eventId: e2 })],
        [login('/available')],
      ] },
    }]);
  });

  it('/open у работника — кнопка Mini App «Открыть приложение», без ссылки и кода входа', async () => {
    expect(await send(101, '/open')).toEqual([{
      text: '📱 <b>Приложение</b>\nНажмите кнопку — приложение откроется в Telegram, входить не нужно.',
      markup: { inline_keyboard: [[login('/shifts')]] },
    }]);
    expect(await testSql`select 1 from worker_login_code`).toEqual([]);
  });

  it('/open без https (локально) — «Не получилось», без кнопки', async () => {
    expect(await send(101, '/open', { origin: 'http://localhost:3000' }))
      .toEqual([{ text: 'Не получилось, попробуйте в приложении', markup: null }]);
  });

  it('/open у менеджера — помощь менеджера, кода нет; неподключённому — подсказка', async () => {
    expect(await send(900, '/open')).toEqual([{ text: MANAGER_HELP, markup: MANAGER_MENU }]);
    expect(await send(555, '/open')).toEqual([{ text: expect.stringContaining('Подключитесь из приложения'), markup: { remove_keyboard: true } }]);
    expect(await testSql`select 1 from worker_login_code`).toEqual([]);
  });

  it('/settings; /help, прочий текст и команды менеджера у работника — помощь работника с меню', async () => {
    expect(await send(101, '/settings')).toEqual([{ text: SETTINGS, markup: { inline_keyboard: [[login('/notifications', 'Открыть настройки')]] } }]);
    for (const t of ['/help', 'привет', '/requests', '/понять', '📥 Заявки и отмены']) {
      expect(await send(101, t)).toEqual([{ text: WORKER_HELP, markup: WORKER_MENU }]);
    }
  });

  it('/requests — заявки и отмены с кнопками, по сообщению на каждую', async () => {
    await testSql`insert into assignment (worker_id, event_id, position_id) values (${ian}, ${ev}, ${hall})`;
    await testSql`insert into signup (worker_id, event_id) values (${pol}, ${ev})`;
    await testSql`update assignment set cancel_requested_at = now() where worker_id = ${ian}`;
    const [{ id: sid }] = await testSql`select id from signup where worker_id = ${pol}`;
    expect(await send(900, '/requests')).toEqual([
      {
        text: '📥 <b>Новая заявка</b>\n👤 Полина\n🗓 Пт, 10 июля\n🎵 Лунный свет',
        markup: { inline_keyboard: [
          [btn('Принять · ЗАЛ', { op: 'ma', signupId: sid, positionId: hall })],
          [btn('Отклонить', { op: 'mr', signupId: sid })],
          [link(`/event/${ev}`)],
        ] },
      },
      {
        text: '⚠️ <b>Не сможет выйти</b>\n👤 Ян\n🗓 Пт, 10 июля\n🎵 Лунный свет',
        markup: { inline_keyboard: [[
          btn('Отпустить', { op: 'mo', eventId: ev, workerId: ian }), btn('Оставить', { op: 'mk', eventId: ev, workerId: ian }),
        ], [link(`/event/${ev}`)]] },
      },
    ]);
  });

  it('/requests — не больше 10, сначала ближайшие; остаток — ссылкой; черновик и прошлое — нет', async () => {
    for (let day = 12; day <= 22; day += 1) {
      const [{ id }] = await testSql`insert into event (event_date, start_time) values (${`2099-07-${day}`}, '20:00') returning id`;
      await testSql`insert into signup (worker_id, event_id) values (${pol}, ${id})`;
    }
    const [{ id: past }] = await testSql`insert into event (event_date, start_time) values ('2099-07-07', '20:00') returning id`;
    await testSql`insert into signup (worker_id, event_id) values (${ian}, ${past})`;
    await testSql`insert into month (month, status) values ('2099-08', 'draft')`;
    const [{ id: draft }] = await testSql`insert into event (event_date, start_time) values ('2099-08-05', '20:00') returning id`;
    await testSql`insert into signup (worker_id, event_id) values (${ian}, ${draft})`;
    const replies = await send(900, '/requests');
    expect(replies).toHaveLength(11);
    expect(replies[0].text).toContain('12 июля');
    expect(replies.slice(0, 10).every((r) => r.text.startsWith('📥 <b>Новая заявка</b>\n👤 Полина') && r.markup !== null)).toBe(true);
    expect(replies[10]).toEqual({ text: 'И ещё 1 — в приложении.', markup: { inline_keyboard: [[link('/month')]] } });
  });

  it('/requests без заявок, /understaffed, помощь менеджера', async () => {
    expect(await send(900, '/requests')).toEqual([{ text: '📥 <b>Заявок и отмен нет</b>', markup: null }]);
    expect(await send(900, '/understaffed')).toEqual([{
      text: '⚠️ <b>Не хватает людей</b>\n• Пт, 10 июля, 20:00 — Лунный свет: 2 места',
      markup: { inline_keyboard: [[link(`/event/${ev}`, 'пт, 10 июл., 20:00')]] },
    }]);
    await testSql`update event_slot set quantity = 0`;
    expect(await send(900, '/understaffed')).toEqual([{ text: '✅ <b>Нехватки нет</b>', markup: null }]);
    expect(await send(900, '/settings')).toEqual([{ text: SETTINGS, markup: { inline_keyboard: [[link('/telegram', 'Открыть настройки')]] } }]);
    for (const t of ['/help', '/shifts', 'привет', '📅 Мои смены']) {
      expect(await send(900, t)).toEqual([{ text: MANAGER_HELP, markup: MANAGER_MENU }]);
    }
  });

  it('/requests: сбой отправки логируется без текста сообщений; 429 прерывает рассылку', async () => {
    for (const day of [12, 13, 14]) {
      const [{ id }] = await testSql`insert into event (event_date, start_time, concert) values (${`2099-07-${day}`}, '20:00', 'СЕКРЕТНЫЙ КОНЦЕРТ') returning id`;
      await testSql`insert into signup (worker_id, event_id) values (${pol}, ${id})`;
    }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let attempts = 0;
    const limited: typeof fetch = async () => {
      attempts += 1;
      return new Response(JSON.stringify({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 3 } }), { status: 429 });
    };
    await handleText(botDeps(telegramApi('TEST', limited)), 900, '/requests');
    expect(attempts).toBe(1);
    expect(errors.mock.calls).toEqual([['telegram: sendMessage failed status=429 description=Too Many Requests']]);

    errors.mockClear();
    const { api, calls } = fakeApi((c) => calls.length === 2 && c.method === 'sendMessage');
    await handleText(botDeps(api), 900, '/requests');
    expect(calls).toHaveLength(3);
    expect(errors.mock.calls).toEqual([['telegram: sendMessage failed status=400 description=Bad Request']]);
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/СЕКРЕТНЫЙ|TEST/);
    vi.restoreAllMocks();
  });

  it('ошибка — общий текст без подробностей', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const replies = await send(101, '/shifts', { worker: () => async () => { throw new Error('boom секрет'); } });
    expect(replies).toEqual([{ text: 'Не получилось, попробуйте в приложении', markup: null }]);
    vi.restoreAllMocks();
  });
});
