import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { resetTestDb, testSql, asManager } from './setup';
import { fakeApi, ORIGIN } from './telegramFakes';
import {
  ensureCommands, MANAGER_COMMANDS, menuCommand, menuKeyboard, removeKeyboard, WORKER_COMMANDS,
} from '@/lib/telegram/menu';
import { runTick } from '@/lib/telegram/tick';

beforeEach(() => resetTestDb());

const saved = async () => (await testSql`select value from app_state where name = 'commands'`)[0]?.value as string | undefined;
const SECRET = 'sec';
const fingerprint = (chat: number | null, bot = SECRET) =>
  createHash('sha256').update(JSON.stringify({ worker: WORKER_COMMANDS, manager: MANAGER_COMMANDS, chat, bot })).digest('hex');
const worker = { method: 'setMyCommands', body: { commands: WORKER_COMMANDS } };
const manager = (chatId: number) => ({ method: 'setMyCommands', body: { commands: MANAGER_COMMANDS, scope: { type: 'chat', chat_id: chatId } } });

describe('меню команд', () => {
  it('списки и описания — как в спецификации', () => {
    expect(WORKER_COMMANDS).toEqual([
      { command: 'shifts', description: 'Мои смены' }, { command: 'free', description: 'Свободные места' },
      { command: 'pay', description: 'Заработок' }, { command: 'settings', description: 'Настройки уведомлений' },
      { command: 'help', description: 'Помощь' },
    ]);
    expect(MANAGER_COMMANDS).toEqual([
      { command: 'requests', description: 'Заявки и отмены' }, { command: 'understaffed', description: 'Нехватка людей' },
      { command: 'settings', description: 'Настройки уведомлений' }, { command: 'help', description: 'Помощь' },
    ]);
  });

  it('постоянное меню внизу чата: работник и менеджер', () => {
    expect(menuKeyboard(false)).toEqual({
      keyboard: [
        [{ text: '📅 Мои смены' }, { text: '🙋 Свободные места' }],
        [{ text: '💰 Заработок' }, { text: '⚙️ Настройки' }],
        [{ text: '❓ Помощь' }],
      ],
      resize_keyboard: true, is_persistent: true,
    });
    expect(menuKeyboard(true)).toEqual({
      keyboard: [[{ text: '📥 Заявки и отмены' }, { text: '⚠️ Нехватка' }], [{ text: '⚙️ Настройки' }, { text: '❓ Помощь' }]],
      resize_keyboard: true, is_persistent: true,
    });
    expect(removeKeyboard()).toEqual({ remove_keyboard: true });
  });

  it('нажатие кнопки меню → команда; прочий текст — null', () => {
    const pairs: Array<[string, string]> = [
      ['📅 Мои смены', 'shifts'], ['🙋 Свободные места', 'free'], ['💰 Заработок', 'pay'], ['⚙️ Настройки', 'settings'],
      ['❓ Помощь', 'help'], ['📥 Заявки и отмены', 'requests'], ['⚠️ Нехватка', 'understaffed'],
      [' ⚙ Настройки ', 'settings'], ['⚠ Нехватка', 'understaffed'],
    ];
    for (const [text, command] of pairs) expect(menuCommand(text), text).toBe(command);
    for (const text of ['Мои смены', 'привет', '/shifts', '📅 Мои смены!']) expect(menuCommand(text), text).toBeNull();
  });

  it('без чата менеджера — только меню по умолчанию, один раз', async () => {
    const { api, calls } = fakeApi();
    await ensureCommands(asManager, api, SECRET);
    await ensureCommands(asManager, api, SECRET);
    expect(calls).toEqual([worker]);
    expect(await saved()).toBe(fingerprint(null));
  });

  it('чат менеджера — своё меню; смена чата — регистрация заново', async () => {
    await testSql`insert into telegram_link (worker_id, chat_id) values (null, 900)`;
    const { api, calls } = fakeApi();
    await ensureCommands(asManager, api, SECRET);
    await ensureCommands(asManager, api, SECRET);
    expect(calls).toEqual([worker, manager(900)]);
    await testSql`update telegram_link set chat_id = 901 where worker_id is null`;
    await ensureCommands(asManager, api, SECRET);
    expect(calls).toEqual([worker, manager(900), worker, manager(901)]);
    expect(await saved()).toBe(fingerprint(901));
  });

  it('другой бот (другой секрет) — меню регистрируется заново', async () => {
    const { api, calls } = fakeApi();
    await ensureCommands(asManager, api, 'bot-a');
    await ensureCommands(asManager, api, 'bot-a');
    expect(calls).toEqual([worker]);
    await ensureCommands(asManager, api, 'bot-b');
    expect(calls).toEqual([worker, worker]);
    expect(await saved()).toBe(fingerprint(null, 'bot-b'));
  });

  it('ошибка любого вызова — отпечаток не пишется, следующий тик пробует снова', async () => {
    await testSql`insert into telegram_link (worker_id, chat_id) values (null, 900)`;
    const failing = fakeApi((c) => c.body.scope !== undefined);
    await ensureCommands(asManager, failing.api, SECRET);
    expect(failing.calls).toHaveLength(2);
    expect(await saved()).toBeUndefined();
    const first = fakeApi((c) => c.body.scope === undefined);
    await ensureCommands(asManager, first.api, SECRET);
    expect(first.calls).toEqual([worker]);
    expect(await saved()).toBeUndefined();
    const { api, calls } = fakeApi();
    await ensureCommands(asManager, api, SECRET);
    expect(calls).toEqual([worker, manager(900)]);
    expect(await saved()).toBe(fingerprint(900));
  });

  it('тик регистрирует меню вместе с вебхуком; без ключа бота — не вызывает Telegram', async () => {
    const { api, calls } = fakeApi();
    await runTick({ now: new Date(), origin: ORIGIN, api, secret: 's', db: asManager });
    await runTick({ now: new Date(), origin: ORIGIN, api, secret: 's', db: asManager });
    expect(calls.map((c) => c.method)).toEqual(['setWebhook', 'setMyCommands']);
    await testSql`delete from app_state`;
    await runTick({ now: new Date(), origin: ORIGIN, api: null, secret: null, db: asManager });
    expect(await saved()).toBeUndefined();
  });
});
