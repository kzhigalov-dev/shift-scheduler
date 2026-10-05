import { describe, it, expect, vi } from 'vitest';
import {
  encodeCallback, isWorkerCallback, packId, parseCallback, unpackId, type Callback,
} from '@/lib/telegram/callbacks';
import {
  appButton, confirmDay, dropCancelButtons, linksOnly, loginButton, managerCancelKeyboard, managerSignupKeyboard, noButtons,
  shiftKeyboard, swapSignupButton, toggleCancelButtons, understaffedKeyboard, webAppButton, withAppLink, withLoginButton, type Keyboard,
} from '@/lib/telegram/keyboards';
import {
  ALREADY_DECIDED_LINE, acceptedLine, appendLine, CANCEL_REQUESTED_LINE, clipText, MAX_TEXT,
} from '@/lib/telegram/messages';
import { telegramApi } from '@/lib/telegram/api';
import { visibleLength } from '@/lib/telegram/html';

const A = '0b7e0c3e-8f2a-4b7c-9d1e-2f3a4b5c6d7e';
const B = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
const C = '00000000-0000-4000-8000-000000000001';
const d = (c: Callback) => encodeCallback(c);

describe('callback_data', () => {
  it('uuid ⇄ 22 символа base64url', () => {
    expect(packId(A)).toBe('C34MPo8qS3ydHi86S1xtfg');
    expect(unpackId(packId(A))).toBe(A);
    expect(unpackId(packId(A.toUpperCase()))).toBe(A);
  });

  it('все операции — туда и обратно, не длиннее 64 байт', () => {
    const all: Callback[] = [
      { op: 'su', eventId: A }, { op: 'sw', eventId: A }, { op: 'cx', eventId: A },
      { op: 'cy', eventId: A }, { op: 'cb', eventId: A },
      { op: 'ma', signupId: A, positionId: B }, { op: 'ma', signupId: A, positionId: null },
      { op: 'mr', signupId: A }, { op: 'mo', eventId: A, workerId: B }, { op: 'mk', eventId: B, workerId: C },
    ];
    for (const c of all) {
      const data = d(c);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(parseCallback(data)).toEqual(c);
    }
    expect(d({ op: 'su', eventId: A })).toBe('su:C34MPo8qS3ydHi86S1xtfg');
  });

  it('«Заработок» за месяц: pm:YYYY-MM, роль — работник', () => {
    expect(d({ op: 'pm', month: '2099-07' })).toBe('pm:2099-07');
    expect(parseCallback('pm:2099-07')).toEqual({ op: 'pm', month: '2099-07' });
    expect(isWorkerCallback({ op: 'pm', month: '2099-07' })).toBe(true);
    for (const data of ['pm', 'pm:', 'pm:2099-13', 'pm:2099-7', 'pm:1899-12', 'pm:2099-07:x', `pm:${packId(A)}`, 'PM:2099-07']) {
      expect(parseCallback(data), data).toBeNull();
    }
  });

  it('«Открыть приложение»: lo[:страница[:месяц]], роль — работник; путь — только из белого списка', () => {
    const all: Array<[string, string]> = [
      ['/shifts', 'lo'], ['/available', 'lo:a'], ['/earnings', 'lo:e'], ['/earnings?month=2099-07', 'lo:e:2099-07'],
      ['/notifications', 'lo:n'],
    ];
    for (const [to, data] of all) {
      expect(d({ op: 'lo', to })).toBe(data);
      expect(parseCallback(data)).toEqual({ op: 'lo', to });
    }
    expect(isWorkerCallback({ op: 'lo', to: '/shifts' })).toBe(true);
    // Чужой путь в кнопку не попадает: кодируется как /shifts.
    expect(d({ op: 'lo', to: 'https://evil.example' })).toBe('lo');
    expect(d({ op: 'lo', to: '/month' })).toBe('lo');
    for (const data of ['lo:', 'lo:s', 'lo:x', 'lo:a:2099-07', 'lo:e:2099-13', 'lo:e:2099-07:x', 'LO', `lo:${packId(A)}`, 'lo:n:']) {
      expect(parseCallback(data), data).toBeNull();
    }
  });

  it('мусор — null', () => {
    const a = packId(A);
    for (const data of [
      '', 'su', 'su:', `zz:${a}`, 'su:abc', `su:${a}x`, `su:${'!'.repeat(22)}`, `su:${a}:${a}`,
      `mo:${a}`, `mr:${a}:${a}`, `ma:${a}:${a}:${a}`, `ma:`, `${'x'.repeat(70)}`, `SU:${a}`,
    ]) {
      expect(parseCallback(data), data).toBeNull();
    }
  });

  it('неканоническая запись id (лишние биты в последнем символе) — null', () => {
    const a = packId(A);
    expect(a.endsWith('g')).toBe(true);
    expect(parseCallback(`su:${a.slice(0, 21)}h`)).toBeNull();
  });

  it('роль операции', () => {
    expect(isWorkerCallback({ op: 'cy', eventId: A })).toBe(true);
    expect(isWorkerCallback({ op: 'mr', signupId: A })).toBe(false);
  });
});

describe('клавиатуры', () => {
  it('«Не смогу» — только если смена не в прошлом', () => {
    expect(shiftKeyboard(A, '2099-07-09', '2099-07-10')).toBeNull();
    expect(shiftKeyboard(A, '2099-07-10', '2099-07-10')).toEqual({
      inline_keyboard: [[{ text: 'Не смогу', callback_data: d({ op: 'cx', eventId: A }) }]],
    });
  });

  it('заявка: по строке на должность (не больше 6), «Отклонить» последней', () => {
    const positions = Array.from({ length: 8 }, (_, i) => ({ id: i % 2 ? B : C, name: `Д${i}` }));
    const kb = managerSignupKeyboard(A, positions);
    expect(kb.inline_keyboard).toHaveLength(7);
    expect(kb.inline_keyboard[0]).toEqual([{ text: 'Принять · Д0', callback_data: d({ op: 'ma', signupId: A, positionId: C }) }]);
    expect(kb.inline_keyboard[6]).toEqual([{ text: 'Отклонить', callback_data: d({ op: 'mr', signupId: A }) }]);
  });

  it('заявка без свободных должностей — одна «Принять» без должности', () => {
    expect(managerSignupKeyboard(A, [])).toEqual({ inline_keyboard: [
      [{ text: 'Принять', callback_data: d({ op: 'ma', signupId: A, positionId: null }) }],
      [{ text: 'Отклонить', callback_data: d({ op: 'mr', signupId: A }) }],
    ] });
  });

  it('«Не сможет выйти» — «Отпустить» и «Оставить» одной строкой', () => {
    expect(managerCancelKeyboard(A, B)).toEqual({ inline_keyboard: [[
      { text: 'Отпустить', callback_data: d({ op: 'mo', eventId: A, workerId: B }) },
      { text: 'Оставить', callback_data: d({ op: 'mk', eventId: A, workerId: B }) },
    ]] });
  });

  it('«Записаться» ⇄ «Отозвать»: меняется только нажатая кнопка, подпись с датой сохраняется', () => {
    const list: Keyboard = { inline_keyboard: [
      [{ text: 'Записаться: пт, 10 июл.', callback_data: d({ op: 'su', eventId: A }) }],
      [{ text: 'Отозвать: сб, 11 июл.', callback_data: d({ op: 'sw', eventId: B }) }],
    ] };
    const after = swapSignupButton(list, 'su', A);
    expect(after.inline_keyboard).toEqual([
      [{ text: 'Отозвать: пт, 10 июл.', callback_data: d({ op: 'sw', eventId: A }) }],
      list.inline_keyboard[1],
    ]);
    expect(swapSignupButton(after, 'sw', A)).toEqual(list);

    const single: Keyboard = { inline_keyboard: [[{ text: 'Записаться', callback_data: d({ op: 'su', eventId: A }) }]] };
    const withdrawn = swapSignupButton(single, 'su', A);
    expect(withdrawn).toEqual({ inline_keyboard: [[{ text: 'Отозвать заявку', callback_data: d({ op: 'sw', eventId: A }) }]] });
    expect(swapSignupButton(withdrawn, 'sw', A)).toEqual(single);
  });

  it('кнопки нет в сообщении — новая кнопка добавляется', () => {
    expect(swapSignupButton(noButtons(), 'su', A)).toEqual({
      inline_keyboard: [[{ text: 'Отозвать заявку', callback_data: d({ op: 'sw', eventId: A }) }]],
    });
  });

  it('повторное или устаревшее нажатие не дублирует кнопки', () => {
    const withdrawn: Keyboard = { inline_keyboard: [[{ text: 'Отозвать заявку', callback_data: d({ op: 'sw', eventId: A }) }]] };
    expect(swapSignupButton(withdrawn, 'su', A)).toEqual(withdrawn);
    const signed: Keyboard = { inline_keyboard: [[{ text: 'Записаться', callback_data: d({ op: 'su', eventId: A }) }]] };
    expect(swapSignupButton(signed, 'sw', A)).toEqual(signed);
    const confirm = toggleCancelButtons(shiftKeyboard(A, '2099-07-10', '2099-07-10') ?? noButtons(), 'cx', A);
    expect(toggleCancelButtons(confirm, 'cx', A)).toEqual(confirm);
    const start: Keyboard = { inline_keyboard: [[{ text: 'Не смогу', callback_data: d({ op: 'cx', eventId: A }) }]] };
    expect(toggleCancelButtons(start, 'cb', A)).toEqual(start);
  });

  it('«Не смогу: <день>» из «Моих смен»: подтверждение с днём, «Назад» возвращает подпись, соседние кнопки не трогаются', () => {
    const url = { text: 'Открыть в приложении', url: 'https://a.app/shifts' };
    const list: Keyboard = { inline_keyboard: [
      [{ text: 'Не смогу: пт, 10 июл.', callback_data: d({ op: 'cx', eventId: A }) }],
      [{ text: 'Не смогу: сб, 11 июл.', callback_data: d({ op: 'cx', eventId: B }) }],
      [url],
    ] };
    const confirm = toggleCancelButtons(list, 'cx', A);
    expect(confirm).toEqual({ inline_keyboard: [
      [
        { text: 'Да, не смогу: пт, 10 июл.', callback_data: d({ op: 'cy', eventId: A }) },
        { text: 'Назад', callback_data: d({ op: 'cb', eventId: A }) },
      ],
      list.inline_keyboard[1], [url],
    ] });
    expect(confirmDay(confirm, A)).toBe('пт, 10 июл.');
    expect(confirmDay(toggleCancelButtons(shiftKeyboard(A, '2099-07-10', '2099-07-10') ?? noButtons(), 'cx', A), A)).toBeUndefined();
    expect(toggleCancelButtons(confirm, 'cb', A)).toEqual(list);
    expect(dropCancelButtons(confirm, A)).toEqual({ inline_keyboard: [list.inline_keyboard[1], [url]] });
    expect(dropCancelButtons(null, A)).toEqual(noButtons());
  });

  it('«Не смогу» → «Да, не смогу» / «Назад» → обратно', () => {
    const start = shiftKeyboard(A, '2099-07-10', '2099-07-10') ?? noButtons();
    const confirm = toggleCancelButtons(start, 'cx', A);
    expect(confirm).toEqual({ inline_keyboard: [[
      { text: 'Да, не смогу', callback_data: d({ op: 'cy', eventId: A }) },
      { text: 'Назад', callback_data: d({ op: 'cb', eventId: A }) },
    ]] });
    expect(toggleCancelButtons(confirm, 'cb', A)).toEqual(start);
  });
});

describe('«Открыть приложение» — кнопка входа из бота (Mini App)', () => {
  /** Работнику — кнопка Mini App: Telegram открывает приложение сразу, вход — по initData (/tg/app). */
  const login = (to: string, text = 'Открыть приложение') => ({ text, web_app: { url: `https://a.app/tg/app?${new URLSearchParams({ to })}` } });

  it('webAppButton: только https, путь после входа — из белого списка', () => {
    expect(webAppButton('https://a.app', '/available')).toEqual(login('/available'));
    expect(webAppButton('https://a.app', '/earnings?month=2099-07', 'Открыть настройки'))
      .toEqual({ text: 'Открыть настройки', web_app: { url: 'https://a.app/tg/app?to=%2Fearnings%3Fmonth%3D2099-07' } });
    expect(webAppButton('https://a.app', '//evil.example')).toEqual(login('/shifts'));
    expect(webAppButton('http://localhost:3000', '/shifts')).toBeNull();
  });

  it('работнику — web_app, менеджеру — прежняя URL-кнопка', () => {
    expect(withLoginButton(null, 'https://a.app', '/shifts')?.inline_keyboard.flat()).toEqual([login('/shifts')]);
    expect(withAppLink(null, 'https://a.app', '/month')?.inline_keyboard.flat()).toEqual([{ text: 'Открыть в приложении', url: 'https://a.app/month' }]);
  });

  it('loginButton (уже отправленные сообщения): callback-кнопка с путём; подпись можно сменить', () => {
    expect(loginButton('/available')).toEqual({ text: 'Открыть приложение', callback_data: 'lo:a' });
    expect(loginButton('/notifications', 'Открыть настройки')).toEqual({ text: 'Открыть настройки', callback_data: 'lo:n' });
  });

  it('withLoginButton: последней строкой; без https (локально) — только кнопки действий или null', () => {
    const cancel = shiftKeyboard(A, '2099-07-10', '2099-07-10');
    expect(withLoginButton(cancel, 'https://a.app', '/shifts')).toEqual({ inline_keyboard: [
      [{ text: 'Не смогу', callback_data: d({ op: 'cx', eventId: A }) }], [login('/shifts')],
    ] });
    expect(withLoginButton(null, 'https://a.app', '/available')).toEqual({ inline_keyboard: [[login('/available')]] });
    expect(withLoginButton(cancel, 'http://localhost', '/shifts')).toEqual(cancel);
    expect(withLoginButton(null, 'http://localhost', '/shifts')).toBeNull();
  });

  it('кнопка входа — как ссылка: замена встаёт перед ней, linksOnly и сброс «Не смогу» её оставляют', () => {
    const open = login('/shifts');
    const start: Keyboard = { inline_keyboard: [[{ text: 'Не смогу', callback_data: d({ op: 'cx', eventId: A }) }], [open]] };
    const confirm = toggleCancelButtons(start, 'cx', A);
    expect(confirm.inline_keyboard[1]).toEqual([open]);
    expect(toggleCancelButtons(confirm, 'cb', A)).toEqual(start);
    expect(swapSignupButton({ inline_keyboard: [[open]] }, 'su', A)).toEqual({ inline_keyboard: [
      [{ text: 'Отозвать заявку', callback_data: d({ op: 'sw', eventId: A }) }], [open],
    ] });
    expect(linksOnly(confirm)).toEqual({ inline_keyboard: [[open]] });
    expect(dropCancelButtons(confirm, A)).toEqual({ inline_keyboard: [[open]] });
    // Старая callback-кнопка «lo» в уже отправленных сообщениях — тоже ссылка.
    const old = loginButton('/shifts');
    expect(linksOnly({ inline_keyboard: [[{ text: 'Не смогу', callback_data: d({ op: 'cx', eventId: A }) }], [old]] }))
      .toEqual({ inline_keyboard: [[old]] });
  });
});

describe('ссылки в приложение', () => {
  const link = (url: string, text = 'Открыть в приложении') => ({ text, url });

  it('appButton: только https; путь с параметрами', () => {
    expect(appButton('https://a.app', '/shifts')).toEqual(link('https://a.app/shifts'));
    expect(appButton('https://a.app', '/earnings?month=2099-07', 'Открыть настройки'))
      .toEqual(link('https://a.app/earnings?month=2099-07', 'Открыть настройки'));
    expect(appButton('http://localhost:3000', '/shifts')).toBeNull();
    expect(appButton('мусор', '/shifts')).toBeNull();
  });

  it('withAppLink: ссылка последней строкой; без https — только кнопки действий или null', () => {
    const cancel = shiftKeyboard(A, '2099-07-10', '2099-07-10');
    expect(withAppLink(cancel, 'https://a.app', '/shifts')).toEqual({ inline_keyboard: [
      [{ text: 'Не смогу', callback_data: d({ op: 'cx', eventId: A }) }],
      [link('https://a.app/shifts')],
    ] });
    expect(withAppLink(null, 'https://a.app', '/available')).toEqual({ inline_keyboard: [[link('https://a.app/available')]] });
    expect(withAppLink(cancel, 'http://localhost', '/shifts')).toEqual(cancel);
    expect(withAppLink(null, 'http://localhost', '/shifts')).toBeNull();
  });

  it('linksOnly: кнопки действий убираются, ссылки остаются', () => {
    const kb: Keyboard = { inline_keyboard: [
      [{ text: 'Да, не смогу', callback_data: d({ op: 'cy', eventId: A }) }, link('https://a.app/x')],
      [{ text: 'Назад', callback_data: d({ op: 'cb', eventId: A }) }],
    ] };
    expect(linksOnly(kb)).toEqual({ inline_keyboard: [[link('https://a.app/x')]] });
    expect(linksOnly(null)).toEqual(noButtons());
  });

  it('нехватка: ссылка на каждое мероприятие (до 5), больше — «Открыть в приложении» на /month', () => {
    const item = (n: number) => ({ eventId: `e${n}`, date: `2099-07-1${n}`, start: '20:00' });
    expect(understaffedKeyboard([item(0)], 'https://a.app')).toEqual({ inline_keyboard: [
      [link('https://a.app/event/e0', 'пт, 10 июл., 20:00')],
    ] });
    const many = understaffedKeyboard([0, 1, 2, 3, 4, 5].map(item), 'https://a.app');
    expect(many?.inline_keyboard).toHaveLength(6);
    expect(many?.inline_keyboard[5]).toEqual([link('https://a.app/month')]);
    expect(understaffedKeyboard([item(0)], 'http://localhost')).toBeNull();
  });

  it('кнопки с ссылкой: замена не трогает ссылку, новая кнопка встаёт перед ней', () => {
    const url = link('https://a.app/shifts');
    const start: Keyboard = { inline_keyboard: [[{ text: 'Не смогу', callback_data: d({ op: 'cx', eventId: A }) }], [url]] };
    const confirm = toggleCancelButtons(start, 'cx', A);
    expect(confirm.inline_keyboard[1]).toEqual([url]);
    expect(toggleCancelButtons(confirm, 'cb', A)).toEqual(start);
    expect(swapSignupButton({ inline_keyboard: [[url]] }, 'su', A)).toEqual({ inline_keyboard: [
      [{ text: 'Отозвать заявку', callback_data: d({ op: 'sw', eventId: A }) }], [url],
    ] });
  });
});

describe('тексты итогов', () => {
  it('строка курсивом через пустую строку; текст итога экранируется', () => {
    expect(appendLine('Заявка: <b>Ян</b>', acceptedLine('ЗАЛ'))).toBe('Заявка: <b>Ян</b>\n\n<i>✓ Принято: ЗАЛ.</i>');
    expect(appendLine('x', acceptedLine('A<B'))).toBe('x\n\n<i>✓ Принято: A&lt;B.</i>');
    expect(acceptedLine(null)).toBe('✓ Принято: без должности.');
    expect(CANCEL_REQUESTED_LINE).toBe('Отмена запрошена — ждём решения менеджера.');
    expect(ALREADY_DECIDED_LINE).toBe('Уже решено в приложении.');
  });

  it('длинный текст обрезается по видимому тексту, теги закрываются, итог остаётся целым', () => {
    const t = appendLine(`<b>${'я'.repeat(5000)}</b>`, ALREADY_DECIDED_LINE);
    expect(visibleLength(t)).toBe(MAX_TEXT);
    expect(t.endsWith(`</b>\n\n<i>${ALREADY_DECIDED_LINE}</i>`)).toBe(true);
    expect(clipText('я'.repeat(5000))).toHaveLength(MAX_TEXT);
  });
});

describe('api: новые параметры', () => {
  const record = () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fake: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    };
    return { api: telegramApi('TEST', fake), bodies };
  };

  it('answerCallbackQuery: show_alert и не длиннее 200 символов', async () => {
    const { api, bodies } = record();
    await api.answerCallbackQuery('q', 'Заявка уже обработана', true);
    await api.answerCallbackQuery('q');
    await api.answerCallbackQuery('q', 'я'.repeat(300));
    expect(bodies[0]).toEqual({ callback_query_id: 'q', text: 'Заявка уже обработана', show_alert: true });
    expect(bodies[1]).toEqual({ callback_query_id: 'q' });
    expect(String(bodies[2].text)).toHaveLength(200);
  });

  it('sendMessage и editMessageText — HTML без превью ссылок, с клавиатурой; setMyCommands со scope', async () => {
    const { api, bodies } = record();
    await api.sendMessage(1, '<b>т</b>');
    await api.editMessageText(1, 2, 'т', noButtons());
    await api.setMyCommands([{ command: 'help', description: 'Помощь' }], { type: 'chat', chat_id: 9 });
    expect(bodies[0]).toEqual({ chat_id: 1, text: '<b>т</b>', parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    expect(bodies[1]).toEqual({
      chat_id: 1, message_id: 2, text: 'т', parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [] },
    });
    expect(bodies[2]).toEqual({ commands: [{ command: 'help', description: 'Помощь' }], scope: { type: 'chat', chat_id: 9 } });
  });

  it('400 «can\'t parse entities» — повтор без parse_mode и без тегов; в лог только код и описание', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bodies: Array<Record<string, unknown>> = [];
    const fake: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return body.parse_mode
        ? new Response(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities: Unsupported start tag" }), { status: 400 })
        : new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    };
    const api = telegramApi('SECRET123', fake);
    const kb = { inline_keyboard: [[{ text: 'Записаться', callback_data: 'su:x' }]] };
    expect(await api.sendMessage(5, '<b>Rock &amp; Roll <3</b>', kb)).toEqual({ ok: true, result: true });
    expect(await api.editMessageText(5, 7, '<i>x</i>')).toEqual({ ok: true, result: true });
    expect(bodies.slice(1)).toEqual([
      { chat_id: 5, text: 'Rock & Roll <3', link_preview_options: { is_disabled: true }, reply_markup: kb },
      { chat_id: 5, message_id: 7, text: '<i>x</i>', parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
      { chat_id: 5, message_id: 7, text: 'x', link_preview_options: { is_disabled: true } },
    ]);
    expect(error.mock.calls).toEqual([
      ["telegram: sendMessage html rejected status=400 description=Bad Request: can't parse entities: Unsupported start tag"],
      ["telegram: editMessageText html rejected status=400 description=Bad Request: can't parse entities: Unsupported start tag"],
    ]);
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/Rock|SECRET123/);
    error.mockRestore();
  });

  it('protect_content: сообщение нельзя переслать и сохранить — и при повторе без разметки (L5)', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fake: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return body.parse_mode
        ? new Response(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities: x" }), { status: 400 })
        : new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await telegramApi('T', fake).sendMessage(5, '<b>x', undefined, { protectContent: true });
    error.mockRestore();
    expect(bodies.map((b) => b.protect_content)).toEqual([true, true]);
    bodies.length = 0;
    await telegramApi('T', async (_u, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    }).sendMessage(5, 'x');
    expect(bodies[0]).not.toHaveProperty('protect_content');
  });

  it('прочие ошибки — без повтора', async () => {
    let calls = 0;
    const fake: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 });
    };
    expect(await telegramApi('T', fake).sendMessage(1, '<b>x</b>')).toEqual({ ok: false, status: 400, description: 'Bad Request: chat not found' });
    expect(calls).toBe(1);
  });
});
