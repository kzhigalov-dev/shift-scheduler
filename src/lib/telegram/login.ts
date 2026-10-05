import { issueWorkerLoginCode, LOGIN_CODE_EVERY_SECONDS, LOGIN_CODE_MINUTES } from '@/lib/auth/workerSession';
import { loginTarget } from '@/lib/auth/loginTarget';
import type { Db } from './delivery';
import { appButton, type Keyboard } from './keyboards';

export const LOGIN_LINK_TEXT = `🔑 Ссылка для входа (действует ${LOGIN_CODE_MINUTES} минут, одноразовая)`;
/** Подпись URL-кнопки под сообщением со ссылкой для входа. */
export const LOGIN_LINK_BUTTON = 'Войти в приложение';
export const LOGIN_SENT = 'Ссылка отправлена';
export const LOGIN_TOO_OFTEN = `Ссылку только что отправили — новая будет доступна через ${LOGIN_CODE_EVERY_SECONDS} секунд`;

export type LoginLink =
  | { kind: 'ok'; text: string; keyboard: Keyboard }
  /** С прошлой выдачи не прошло 30 секунд: прежняя ссылка ещё действует. */
  | { kind: 'too_often' }
  /** Адрес приложения не `https://` (локальная разработка): ссылку не на что дать, код не выдаётся. */
  | { kind: 'no_https' };

/**
 * Одноразовая ссылка для входа `https://<origin>/tg/<код>?to=<путь>` от имени работника — владельца чата
 * (`asOwner` — его withWorker: код выдаётся только работнику, функция берёт его из личности сессии).
 * `to` — только из белого списка (`loginTarget`). Текст — постоянный, без данных из базы.
 */
export async function loginLink(asOwner: Db, origin: string, to: string, chatId: number): Promise<LoginLink> {
  if (!appButton(origin, '/tg/')) return { kind: 'no_https' };
  const code = await asOwner((tx) => issueWorkerLoginCode(tx, chatId));
  if (code === null) return { kind: 'too_often' };
  const query = new URLSearchParams({ to: loginTarget(to) });
  const button = appButton(origin, `/tg/${code}?${query}`, LOGIN_LINK_BUTTON);
  if (!button) return { kind: 'no_https' };
  return { kind: 'ok', text: LOGIN_LINK_TEXT, keyboard: { inline_keyboard: [[button]] } };
}
