import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка initData Telegram Mini App (кнопка «Открыть приложение» — `web_app`) строго по спецификации:
 * secret_key = HMAC_SHA256(key = "WebAppData", msg = bot_token);
 * hash = hex(HMAC_SHA256(key = secret_key, msg = data_check_string)), где data_check_string — все поля,
 * кроме `hash`, по ключу, `key=value` через `\n`. Чистая функция: время — параметром. Ни initData,
 * ни hash не логируются.
 */

/**
 * initData старше часа не принимается (L5 полного ревью безопасности): страница отправляет их через секунду
 * после открытия, а перехваченные до первого входа не должны действовать сутки. = срок записи защиты от
 * повтора в `webapp_login` (0015: час и 5 минут сдвига часов).
 */
export const WEBAPP_MAX_AGE_SECONDS = 60 * 60;
/** Допустимое расхождение часов: auth_date из будущего — не дальше 5 минут. */
export const WEBAPP_FUTURE_SKEW_SECONDS = 5 * 60;
/** initData — несколько сотен байт; длиннее — не от Telegram. */
const MAX_INIT_DATA = 4096;
const HEX64 = /^[0-9a-f]{64}$/;

export type WebAppAuth = {
  /** id пользователя Telegram; в личном чате с ботом он же chat_id привязки. */
  userId: number;
  /** auth_date, секунды Unix. */
  authDate: number;
  /** hash initData — ключ защиты от повтора (`telegram_webapp_login`). */
  hash: string;
};
export type WebAppCheck =
  | { ok: true; auth: WebAppAuth }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'future' | 'no_user' };

export function verifyInitData(initData: string, botToken: string, nowSeconds: number): WebAppCheck {
  if (initData.length === 0 || initData.length > MAX_INIT_DATA) return { ok: false, reason: 'malformed' };
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(initData)) {
    if (fields.has(key)) return { ok: false, reason: 'malformed' };
    fields.set(key, value);
  }
  const hash = fields.get('hash');
  const authRaw = fields.get('auth_date');
  if (!hash || !HEX64.test(hash) || !authRaw || !/^\d{1,12}$/.test(authRaw)) return { ok: false, reason: 'malformed' };
  fields.delete('hash');

  const check = [...fields.keys()].sort().map((key) => `${key}=${fields.get(key)}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return { ok: false, reason: 'signature' };

  const authDate = Number(authRaw);
  if (nowSeconds - authDate > WEBAPP_MAX_AGE_SECONDS) return { ok: false, reason: 'expired' };
  if (authDate - nowSeconds > WEBAPP_FUTURE_SKEW_SECONDS) return { ok: false, reason: 'future' };

  const userId = parseUserId(fields.get('user'));
  return userId === null ? { ok: false, reason: 'no_user' } : { ok: true, auth: { userId, authDate, hash } };
}

/** `user` — JSON с целым положительным `id`; иначе null. */
function parseUserId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let user: unknown;
  try {
    user = JSON.parse(raw);
  } catch {
    return null;
  }
  const id = typeof user === 'object' && user !== null && 'id' in user ? user.id : null;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Итог `webapp_login` (0013_review_fixes.sql). */
export type WebAppLoginStatus = 'ok' | 'kept' | 'replay' | 'too_often' | 'unlinked' | 'manager' | 'archived' | 'denied';

/** Текст отказа для человека — без подробностей проверки. */
export const WEBAPP_ERRORS: Record<Exclude<WebAppLoginStatus, 'ok' | 'kept'> | 'not_configured' | 'invalid' | 'expired', string> = {
  not_configured: 'Вход из Telegram пока не настроен. Откройте личную ссылку от менеджера.',
  invalid: 'Не получилось проверить вход из Telegram. Нажмите «Открыть приложение» в боте ещё раз.',
  expired: 'Кнопка устарела — нажмите «Открыть приложение» в боте ещё раз.',
  replay: 'Эта кнопка уже сработала — нажмите «Открыть приложение» в боте ещё раз.',
  too_often: 'Слишком много входов подряд — подождите минуту и попробуйте снова.',
  unlinked: 'Этот Telegram не подключён к кабинету работника. Подключите его в приложении: «Уведомления» → «Подключить Telegram».',
  manager: 'Это чат менеджера: кабинет работника из него не открывается. Менеджер входит по паролю.',
  archived: 'Доступ к кабинету закрыт — обратитесь к менеджеру.',
  denied: 'Не получилось войти. Нажмите «Открыть приложение» в боте ещё раз.',
};
