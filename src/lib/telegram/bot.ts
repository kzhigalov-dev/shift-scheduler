import type { TelegramApi } from './api';
import { handleCallback } from './buttons';
import { handleText } from './commands';
import type { Db } from './delivery';
import { linkTelegram, telegramOwner } from './links';
import { menuKeyboard, removeKeyboard } from './menu';
import { BUTTON_STALE, HINT_TEXT, linkedText, START_STALE_TEXT, startOkText } from './messages';
import type { BotUpdate } from './update';

/**
 * Всё, что нужно обработчику обновления. В проде — withAnon / withWorker / withManager,
 * настоящий API и revalidatePath; в тестах — роли приложения на базе *_test и подменённый fetch.
 */
export type BotDeps = {
  api: TelegramApi;
  origin: string;
  /** Только для московских даты и месяца (`/pay`, `/requests`, `/understaffed`). */
  now: Date;
  anon: Db;
  worker: (workerId: string) => Db;
  manager: Db;
  revalidate: (paths: string[]) => void;
};

/** Владелец чата по `telegram_owner`: работник (`workerId`) или менеджер. */
export type Owner = { workerId: string | null; isManager: boolean };

/**
 * Одно обновление Telegram: привязка по `/start`, текст, нажатие кнопки. После подключения и на `/start`
 * подключённого чата — постоянное меню его роли; неподключённому — подсказка, меню убирается.
 */
export async function handleUpdate(deps: BotDeps, update: BotUpdate): Promise<void> {
  if (update.kind === 'start') {
    const { chatId, code } = update;
    if (code) {
      const result = await deps.anon((tx) => linkTelegram(tx, code, chatId));
      if (result === 'invalid') await deps.api.sendMessage(chatId, START_STALE_TEXT);
      else await deps.api.sendMessage(chatId, startOkText(result === 'manager'), menuKeyboard(result === 'manager'));
      return;
    }
    const owner = await deps.anon((tx) => telegramOwner(tx, chatId));
    if (owner) await deps.api.sendMessage(chatId, linkedText(owner.workerId === null), menuKeyboard(owner.workerId === null));
    else await deps.api.sendMessage(chatId, HINT_TEXT, removeKeyboard());
  } else if (update.kind === 'text') {
    await handleText(deps, update.chatId, update.text);
  } else if (update.kind === 'callback') {
    await handleCallback(deps, update);
  } else if (update.kind === 'callback_invalid') {
    await deps.api.answerCallbackQuery(update.callbackId, BUTTON_STALE);
  }
}
