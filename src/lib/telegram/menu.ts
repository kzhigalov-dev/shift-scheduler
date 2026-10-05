import { createHash } from 'node:crypto';
import type { TelegramApi } from './api';
import type { Db } from './delivery';

export type BotCommand = { command: string; description: string };

/** Меню по умолчанию — команды работника. */
export const WORKER_COMMANDS: BotCommand[] = [
  { command: 'shifts', description: 'Мои смены' },
  { command: 'free', description: 'Свободные места' },
  { command: 'pay', description: 'Заработок' },
  { command: 'settings', description: 'Настройки уведомлений' },
  { command: 'help', description: 'Помощь' },
];

/** Меню чата менеджера (scope `chat`). */
export const MANAGER_COMMANDS: BotCommand[] = [
  { command: 'requests', description: 'Заявки и отмены' },
  { command: 'understaffed', description: 'Нехватка людей' },
  { command: 'settings', description: 'Настройки уведомлений' },
  { command: 'help', description: 'Помощь' },
];

/** Кнопка постоянного меню внизу чата: нажатие приходит текстом подписи и работает как команда. */
export type MenuItem = { label: string; command: string };
export const WORKER_MENU: MenuItem[][] = [
  [{ label: '📅 Мои смены', command: 'shifts' }, { label: '🙋 Свободные места', command: 'free' }],
  [{ label: '💰 Заработок', command: 'pay' }, { label: '⚙️ Настройки', command: 'settings' }],
  [{ label: '❓ Помощь', command: 'help' }],
];
export const MANAGER_MENU: MenuItem[][] = [
  [{ label: '📥 Заявки и отмены', command: 'requests' }, { label: '⚠️ Нехватка', command: 'understaffed' }],
  [{ label: '⚙️ Настройки', command: 'settings' }, { label: '❓ Помощь', command: 'help' }],
];

/** `ReplyKeyboardMarkup`; с inline-кнопками в одном сообщении не сочетается — уходит отдельными ответами. */
export type MenuKeyboard = { keyboard: Array<Array<{ text: string }>>; resize_keyboard: true; is_persistent: true };
/** Убрать меню у неподключённого чата. */
export type RemoveKeyboard = { remove_keyboard: true };

export function menuKeyboard(isManager: boolean): MenuKeyboard {
  const rows = isManager ? MANAGER_MENU : WORKER_MENU;
  return { keyboard: rows.map((row) => row.map((item) => ({ text: item.label }))), resize_keyboard: true, is_persistent: true };
}
export const removeKeyboard = (): RemoveKeyboard => ({ remove_keyboard: true });

/** Вариационный селектор эмодзи (U+FE0F) клиенты иногда теряют — сравниваем без него. */
const plain = (text: string): string => text.replace(/️/g, '').trim();
const MENU_COMMANDS = new Map([...WORKER_MENU, ...MANAGER_MENU].flat().map((item) => [plain(item.label), item.command]));

/** Текст нажатой кнопки меню → команда; прочий текст — null. Роль не проверяется: это делает обработчик команд. */
export const menuCommand = (text: string): string | null => MENU_COMMANDS.get(plain(text)) ?? null;

/**
 * Отпечаток обоих списков, чата менеджера и бота (секрет вебхука выводится из ключа бота, в отпечаток
 * входит только его хеш): изменилось что-то, в том числе бот, — меню регистрируется заново.
 */
export const commandsFingerprint = (managerChatId: number | null, secret: string): string =>
  createHash('sha256')
    .update(JSON.stringify({ worker: WORKER_COMMANDS, manager: MANAGER_COMMANDS, chat: managerChatId, bot: secret }))
    .digest('hex');

/**
 * Регистрирует меню команд, если отпечаток в `app_state('commands')` не совпал. Чтение и запись —
 * короткими транзакциями, запросы к Telegram — вне транзакции; отпечаток — только после успеха всех вызовов.
 */
export async function ensureCommands(db: Db, api: TelegramApi, secret: string): Promise<void> {
  const state = await db(async (tx) => {
    const [link] = await tx<Array<{ chat_id: string }>>`select chat_id from telegram_link where worker_id is null`;
    const [row] = await tx<Array<{ value: string }>>`select value from app_state where name = 'commands'`;
    return { chatId: link ? Number(link.chat_id) : null, saved: row?.value ?? null };
  });
  const fingerprint = commandsFingerprint(state.chatId, secret);
  if (state.saved === fingerprint) return;
  if (!(await api.setMyCommands(WORKER_COMMANDS)).ok) return;
  if (state.chatId !== null
    && !(await api.setMyCommands(MANAGER_COMMANDS, { type: 'chat', chat_id: state.chatId })).ok) return;
  await db((tx) => tx`insert into app_state (name, value) values ('commands', ${fingerprint})
    on conflict (name) do update set value = excluded.value`);
}
