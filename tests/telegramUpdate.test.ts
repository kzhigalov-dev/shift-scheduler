import { describe, it, expect } from 'vitest';
import { parseUpdate } from '@/lib/telegram/update';

const message = (text: unknown, chatId: unknown = 42, type = 'private') => ({ update_id: 1, message: { message_id: 7, chat: { id: chatId, type }, text } });

describe('parseUpdate', () => {
  it('/start с кодом', () => {
    expect(parseUpdate(message('/start abc'))).toEqual({ kind: 'start', chatId: 42, code: 'abc' });
  });

  it('/start без кода и с именем бота', () => {
    expect(parseUpdate(message('/start'))).toEqual({ kind: 'start', chatId: 42, code: null });
    expect(parseUpdate(message('/start@DemoShiftsBot A-b_9'))).toEqual({ kind: 'start', chatId: 42, code: 'A-b_9' });
  });

  it('сообщения не из личного чата — other', () => {
    expect(parseUpdate(message('/start@DemoShiftsBot abc', -100, 'supergroup'))).toEqual({ kind: 'other' });
    expect(parseUpdate(message('/start', -100, 'group'))).toEqual({ kind: 'other' });
    expect(parseUpdate(message('привет', -100, 'group'))).toEqual({ kind: 'other' });
    expect(parseUpdate({ message: { chat: { id: 5 }, text: '/start abc' } })).toEqual({ kind: 'other' });
  });

  it('обычный текст', () => {
    expect(parseUpdate(message('привет'))).toEqual({ kind: 'text', chatId: 42, text: 'привет' });
    expect(parseUpdate(message('/startx abc'))).toEqual({ kind: 'text', chatId: 42, text: '/startx abc' });
  });

  it('код длиннее 64 или с чужими символами — code: null', () => {
    expect(parseUpdate(message(`/start ${'a'.repeat(64)}`))).toEqual({ kind: 'start', chatId: 42, code: 'a'.repeat(64) });
    expect(parseUpdate(message(`/start ${'a'.repeat(65)}`))).toEqual({ kind: 'start', chatId: 42, code: null });
    expect(parseUpdate(message('/start ab$c'))).toEqual({ kind: 'start', chatId: 42, code: null });
    expect(parseUpdate(message('/start a b'))).toEqual({ kind: 'start', chatId: 42, code: null });
  });

  const press = (message: Record<string, unknown>, data: unknown = 'su:x', from: unknown = { id: (message.chat as { id: number }).id }) =>
    ({ update_id: 2, callback_query: { id: 'cb1', data, message, from } });

  it('callback_query: текст и кнопки сообщения', () => {
    const keyboard = { inline_keyboard: [[{ text: 'Записаться', callback_data: 'su:x' }]] };
    expect(parseUpdate(press({ message_id: 9, chat: { id: 42, type: 'private' }, text: 'Нужен человек', reply_markup: keyboard })))
      .toEqual({ kind: 'callback', chatId: 42, messageId: 9, callbackId: 'cb1', data: 'su:x', html: 'Нужен человек', keyboard });
  });

  it('callback_query: разметка из entities — HTML, текст экранирован', () => {
    const message = {
      message_id: 9, chat: { id: 42, type: 'private' },
      text: '🙋 Нужен человек\n🎵 Rock & <Roll>',
      entities: [{ type: 'bold', offset: 3, length: 13 }, { type: 'mention', offset: 0, length: 1 }, { type: 'italic', offset: 'x', length: 1 }, 'мусор'],
    };
    expect(parseUpdate(press(message))).toMatchObject({ kind: 'callback', html: '🙋 <b>Нужен человек</b>\n🎵 Rock &amp; &lt;Roll&gt;' });
    expect(parseUpdate(press({ ...message, entities: 'мусор' }))).toMatchObject({ html: '🙋 Нужен человек\n🎵 Rock &amp; &lt;Roll&gt;' });
  });

  it('callback_query: кнопки-ссылки разбираются вместе с кнопками действий', () => {
    const keyboard = { inline_keyboard: [
      [{ text: 'Не смогу', callback_data: 'cx:x' }],
      [{ text: 'Открыть в приложении', url: 'https://a.app/shifts' }],
    ] };
    expect(parseUpdate(press({ message_id: 9, chat: { id: 42, type: 'private' }, text: 't', reply_markup: keyboard })))
      .toMatchObject({ kind: 'callback', keyboard });
  });

  it('callback_query: кнопка Mini App (web_app) разбирается — правка её не теряет', () => {
    const keyboard = { inline_keyboard: [
      [{ text: 'Не смогу', callback_data: 'cx:x' }],
      [{ text: 'Открыть приложение', web_app: { url: 'https://a.app/tg/app?to=%2Fshifts' } }],
    ] };
    expect(parseUpdate(press({ message_id: 9, chat: { id: 42, type: 'private' }, text: 't', reply_markup: keyboard })))
      .toMatchObject({ kind: 'callback', keyboard });
  });

  it('callback_query без текста и кнопок — null; кнопки не по форме — null', () => {
    expect(parseUpdate(press({ message_id: 9, chat: { id: 42, type: 'private' } })))
      .toEqual({ kind: 'callback', chatId: 42, messageId: 9, callbackId: 'cb1', data: 'su:x', html: null, keyboard: null });
    const game = { inline_keyboard: [[{ text: 'Игра', callback_game: {} }]] };
    expect(parseUpdate(press({ message_id: 9, chat: { id: 42, type: 'private' }, text: 't', reply_markup: game })))
      .toMatchObject({ kind: 'callback', keyboard: null });
    const badApp = { inline_keyboard: [[{ text: 'Приложение', web_app: { url: 1 } }]] };
    expect(parseUpdate(press({ message_id: 9, chat: { id: 42, type: 'private' }, text: 't', reply_markup: badApp })))
      .toMatchObject({ kind: 'callback', keyboard: null });
    expect(parseUpdate(press({ message_id: 9, chat: { id: 42, type: 'private' }, text: 't', reply_markup: { inline_keyboard: 'x' } })))
      .toMatchObject({ kind: 'callback', keyboard: null });
  });

  it('callback_query не из личного чата — callback_invalid (ответить «устарела», без действий)', () => {
    const invalid = { kind: 'callback_invalid', callbackId: 'cb1' };
    expect(parseUpdate(press({ message_id: 9, chat: { id: -100, type: 'supergroup' }, text: 't' }))).toEqual(invalid);
    expect(parseUpdate(press({ message_id: 9, chat: { id: 42 }, text: 't' }))).toEqual(invalid);
  });

  it('callback_query: нажал не владелец чата (пересланное сообщение) — callback_invalid', () => {
    const message = { message_id: 9, chat: { id: 42, type: 'private' }, text: 't' };
    const invalid = { kind: 'callback_invalid', callbackId: 'cb1' };
    expect(parseUpdate(press(message, 'su:x', { id: 43 }))).toEqual(invalid);
    expect(parseUpdate(press(message, 'su:x', null))).toEqual(invalid);
    expect(parseUpdate(press(message, 'su:x', { id: '42' }))).toEqual(invalid);
    expect(parseUpdate(press(message, 'su:x', { id: 42 }))).toMatchObject({ kind: 'callback', chatId: 42 });
  });

  it('callback_query без сообщения или данных — callback_invalid; без id — other', () => {
    const invalid = { kind: 'callback_invalid', callbackId: 'cb1' };
    expect(parseUpdate({ callback_query: { id: 'cb1', data: 'su:x', from: { id: 42 } } })).toEqual(invalid);
    expect(parseUpdate({ callback_query: { id: 'cb1', from: { id: 42 }, message: { message_id: 9, chat: { id: 42, type: 'private' } } } })).toEqual(invalid);
    expect(parseUpdate({ callback_query: { data: 'su:x', message: { message_id: 9, chat: { id: 42, type: 'private' } } } })).toEqual({ kind: 'other' });
  });

  it('неполные и чужие поля — other', () => {
    expect(parseUpdate(message(5))).toEqual({ kind: 'other' });
    expect(parseUpdate(message('hi', '42'))).toEqual({ kind: 'other' });
    expect(parseUpdate({ message: { chat: { id: 1 } } })).toEqual({ kind: 'other' });
  });

  it('мусор — other', () => {
    for (const raw of [null, undefined, [], {}, 'x', 5, { message: null }]) {
      expect(parseUpdate(raw)).toEqual({ kind: 'other' });
    }
  });
});
