import { entitiesToHtml, type MessageEntity } from './html';
import type { Button, Keyboard } from './keyboards';

export type BotUpdate =
  | { kind: 'start'; chatId: number; code: string | null }
  | { kind: 'text'; chatId: number; text: string }
  | {
    kind: 'callback'; chatId: number; messageId: number; callbackId: string; data: string;
    /**
     * Сообщение, под которым нажали: текст — HTML, собранный из `text` и `entities` (разметка
     * сохраняется при правке); кнопки. null — Telegram их не прислал или они не по форме.
     */
    html: string | null; keyboard: Keyboard | null;
  }
  /** Нажатие, которое нельзя разобрать или принять (группа, нет сообщения или данных, нажал не владелец чата): отвечаем «устарела», база не нужна. */
  | { kind: 'callback_invalid'; callbackId: string }
  | { kind: 'other' };
export type CallbackUpdate = Extract<BotUpdate, { kind: 'callback' }>;

const OTHER: BotUpdate = { kind: 'other' };
const START = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function chatIdOf(message: Record<string, unknown>): number | null {
  const id = record(message.chat)?.id;
  return typeof id === 'number' && Number.isSafeInteger(id) ? id : null;
}

const isPrivate = (message: Record<string, unknown>): boolean => record(message.chat)?.type === 'private';

/** Кнопка сообщения: `text` и `callback_data`, `url` или `web_app.url` (Mini App); иначе null. */
function parseButton(item: unknown): Button | null {
  const b = record(item);
  if (!b || typeof b.text !== 'string') return null;
  if (typeof b.callback_data === 'string') return { text: b.text, callback_data: b.callback_data };
  if (typeof b.url === 'string') return { text: b.text, url: b.url };
  const app = record(b.web_app)?.url;
  if (typeof app === 'string') return { text: b.text, web_app: { url: app } };
  return null;
}

/** Кнопки сообщения: только строки из кнопок-действий и ссылок; иначе null. */
function parseKeyboard(raw: unknown): Keyboard | null {
  const rows = record(raw)?.inline_keyboard;
  if (!Array.isArray(rows)) return null;
  const keyboard: Button[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) return null;
    const buttons: Button[] = [];
    for (const item of row) {
      const b = parseButton(item);
      if (!b) return null;
      buttons.push(b);
    }
    keyboard.push(buttons);
  }
  return { inline_keyboard: keyboard };
}

/** Разметка сообщения: сущности не по форме пропускаются (текст останется без них). */
function parseEntities(raw: unknown): MessageEntity[] {
  if (!Array.isArray(raw)) return [];
  const entities: MessageEntity[] = [];
  for (const item of raw) {
    const e = record(item);
    if (!e || typeof e.type !== 'string' || typeof e.offset !== 'number' || typeof e.length !== 'number') continue;
    entities.push({ type: e.type, offset: e.offset, length: e.length, ...(typeof e.url === 'string' ? { url: e.url } : {}) });
  }
  return entities;
}

/** Разбор JSON обновления Telegram (граница ввода): всё непонятное — `other`. */
export function parseUpdate(raw: unknown): BotUpdate {
  const root = record(raw);
  if (!root) return OTHER;

  const message = record(root.message);
  if (message) {
    const chatId = chatIdOf(message);
    if (chatId === null || typeof message.text !== 'string') return OTHER;
    // Бот отвечает только в личном чате: в группе привязку и подсказки увидели бы все участники.
    if (!isPrivate(message)) return OTHER;
    const start = START.exec(message.text);
    if (start) return { kind: 'start', chatId, code: start[1] ?? null };
    // `/start` с чужим кодом (длинным или с лишними символами) — всё равно /start, но без кода.
    if (/^\/start(?:@\w+)?(?:\s|$)/.test(message.text)) return { kind: 'start', chatId, code: null };
    return { kind: 'text', chatId, text: message.text };
  }

  const callback = record(root.callback_query);
  if (callback) {
    // Без id ответить на нажатие нечем.
    if (typeof callback.id !== 'string') return OTHER;
    const invalid: BotUpdate = { kind: 'callback_invalid', callbackId: callback.id };
    const origin = record(callback.message);
    if (!origin || typeof callback.data !== 'string') return invalid;
    const chatId = chatIdOf(origin);
    const messageId = origin.message_id;
    if (chatId === null || typeof messageId !== 'number' || !isPrivate(origin)) return invalid;
    // В личном чате нажимает тот, чей это чат; иначе (пересланное сообщение) действовать от имени чата нельзя.
    if (record(callback.from)?.id !== chatId) return invalid;
    return {
      kind: 'callback', chatId, messageId, callbackId: callback.id, data: callback.data,
      html: typeof origin.text === 'string' ? entitiesToHtml(origin.text, parseEntities(origin.entities)) : null,
      keyboard: parseKeyboard(origin.reply_markup),
    };
  }
  return OTHER;
}
