import { stripHtml } from './html';

export type TelegramFetch = typeof fetch;
/** JSON-значение: тела запросов, `reply_markup` из базы и результаты Bot API. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type ApiResult<T = Json> =
  | { ok: true; result: T }
  | { ok: false; status: number; description: string; retryAfter?: number };

export const REQUEST_TIMEOUT_MS = 10_000;
/** Telegram не разобрал HTML сообщения (ошибка разметки или старый текст в очереди). */
const CANT_PARSE = /can't parse entities/i;

export type SendOptions = { protectContent?: boolean };

type BotResponse<T> = { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } };

/**
 * Тонкая обёртка над Bot API. Ключ входит только в адрес запроса и не логируется
 * ни при каких ошибках: сетевая ошибка и таймаут превращаются в `status: 0` без текста исключения.
 */
export function telegramApi(token: string, fetchImpl: TelegramFetch = fetch) {
  async function call<T = Json>(method: string, body: JsonObject): Promise<ApiResult<T>> {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // Тип ответа Bot API описан; значения проверяются по `ok`.
      const json = (await res.json()) as BotResponse<T>;
      if (json.ok) return { ok: true, result: json.result as T };
      const retryAfter = json.parameters?.retry_after;
      return {
        ok: false, status: res.status, description: json.description ?? '',
        ...(typeof retryAfter === 'number' ? { retryAfter } : {}),
      };
    } catch {
      return { ok: false, status: 0, description: 'network' };
    }
  }
  /**
   * Сообщение в HTML без превью ссылок. 400 «can't parse entities» — повтор тем же текстом без тегов
   * и без `parse_mode` (клавиатура та же); в лог — только код и описание ответа.
   */
  async function callHtml(
    method: 'sendMessage' | 'editMessageText', target: JsonObject, text: string, replyMarkup?: JsonObject, extra: JsonObject = {},
  ) {
    const rest: JsonObject = { link_preview_options: { is_disabled: true }, ...(replyMarkup ? { reply_markup: replyMarkup } : {}), ...extra };
    const res = await call(method, { ...target, text, parse_mode: 'HTML', ...rest });
    if (res.ok || res.status !== 400 || !CANT_PARSE.test(res.description)) return res;
    console.error(`telegram: ${method} html rejected status=${res.status} description=${res.description}`);
    return call(method, { ...target, text: stripHtml(text), ...rest });
  }
  return {
    /** `protectContent` — сообщение нельзя переслать и сохранить (ссылка для входа). */
    sendMessage: (chatId: number, text: string, replyMarkup?: JsonObject, options: SendOptions = {}) =>
      callHtml('sendMessage', { chat_id: chatId }, text, replyMarkup, options.protectContent ? { protect_content: true } : {}),
    editMessageText: (chatId: number, messageId: number, text: string, replyMarkup?: JsonObject) =>
      callHtml('editMessageText', { chat_id: chatId, message_id: messageId }, text, replyMarkup),
    /** Ответ на нажатие; Telegram принимает до 200 символов. `showAlert` — окно вместо всплывающей строки. */
    answerCallbackQuery: (id: string, text?: string, showAlert?: boolean) =>
      call('answerCallbackQuery', {
        callback_query_id: id,
        ...(text ? { text: Array.from(text).slice(0, 200).join('') } : {}),
        ...(showAlert ? { show_alert: true } : {}),
      }),
    setWebhook: (url: string, secret: string) =>
      call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'] }),
    getWebhookInfo: () =>
      call<{ url: string; last_error_message?: string; pending_update_count?: number }>('getWebhookInfo', {}),
    setMyCommands: (commands: Array<{ command: string; description: string }>, scope?: { type: 'chat'; chat_id: number }) =>
      call('setMyCommands', { commands, ...(scope ? { scope } : {}) }),
  };
}
export type TelegramApi = ReturnType<typeof telegramApi>;
