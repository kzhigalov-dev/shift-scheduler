'use server';

import { redirect } from 'next/navigation';
import { getCurrentWorker, loginWithCode, loginWithPersonalLink, loginWithWebApp } from '@/lib/auth/session';
import { loginCodeInfo } from '@/lib/auth/workerLookup';
import { loginTarget } from '@/lib/auth/loginTarget';
import { botToken } from '@/lib/telegram/config';
import { verifyInitData, WEBAPP_ERRORS } from '@/lib/telegram/webApp';

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * «Войти» на `/tg/<код>`: права — сам одноразовый код (погашение — функцией security definer). Код, сессия
 * и закрытие прежних ролей браузера — одной транзакцией (`loginWithCode`). Не принят: браузер уже вошёл
 * (повтор запроса) — в приложение; код использован — «уже использована»; иначе — «устарела».
 * Server action сверяет Origin с Host: чужой сайт эту форму не отправит.
 */
export async function confirmLoginAction(form: FormData): Promise<void> {
  const code = field(form, 'code');
  const to = loginTarget(field(form, 'to'));
  if (await loginWithCode(code)) redirect(to);
  if (await getCurrentWorker()) redirect(to);
  redirect((await loginCodeInfo(code)).state === 'used' ? '/login?error=tg-used' : '/login?error=tg');
}

/**
 * «Войти» на `/w/<токен>/confirm`: права — сам токен личной ссылки, его проверяет и меняет на сессию работника
 * функция security definer (`personal_link_login`) — в cookie только токен сессии (L6). Сессия и закрытие
 * прежних ролей браузера — одной транзакцией. Server action сверяет Origin с Host.
 */
export async function confirmPersonalLinkAction(form: FormData): Promise<void> {
  if (await loginWithPersonalLink(field(form, 'token'))) redirect('/shifts');
  redirect('/login?error=link');
}

export type WebAppLoginResult = { to: string } | { error: string };

/**
 * Вход из Telegram Mini App (`/tg/app`): права — initData, подписанные Telegram ключом бота (`verifyInitData`:
 * HMAC по спецификации, не старше часа). Пользователь Telegram → его подключённый чат → работник; сессия,
 * защита от повтора и закрытие прежних ролей браузера — одной транзакцией (`loginWithWebApp`). Возвращает
 * путь из белого списка — страница переходит туда сама. initData и hash не логируются.
 */
export async function webAppLoginAction(initData: unknown, to: unknown): Promise<WebAppLoginResult> {
  const token = botToken();
  if (!token) return { error: WEBAPP_ERRORS.not_configured };
  const check = verifyInitData(typeof initData === 'string' ? initData : '', token, Math.floor(Date.now() / 1000));
  if (!check.ok) {
    return { error: check.reason === 'expired' || check.reason === 'future' ? WEBAPP_ERRORS.expired : WEBAPP_ERRORS.invalid };
  }
  const status = await loginWithWebApp(check.auth);
  if (status === 'ok' || status === 'kept') return { to: loginTarget(typeof to === 'string' ? to : null) };
  return { error: WEBAPP_ERRORS[status] };
}
