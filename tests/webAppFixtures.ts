import { createHmac } from 'node:crypto';

/** Тестовый ключ бота: настоящего в тестах нет, в Telegram тесты не ходят. */
export const WEBAPP_TEST_TOKEN = '123456:TEST-token';

/**
 * initData Mini App, подписанные как это делает Telegram: secret_key = HMAC_SHA256(key="WebAppData",
 * msg=bot_token), hash = hex(HMAC_SHA256(key=secret_key, msg=data_check_string)); data_check_string —
 * все поля, кроме hash, по ключу, `key=value` через `\n`.
 */
export function signInitData(fields: Record<string, string>, token = WEBAPP_TEST_TOKEN): string {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

export const tgUser = (id: number) => JSON.stringify({ id, first_name: 'Ян', language_code: 'ru' });
