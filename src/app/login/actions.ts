'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { withAnon } from '@/db/client';
import { verifyManagerPassword, loginFailDelay } from '@/lib/auth/managerPassword';
import { clientIp, loginIpHash, isLoginAllowed, noteLoginFailure } from '@/lib/auth/loginThrottle';
import { startManagerSession, endManagerSession } from '@/lib/auth/session';

export type LoginState = { error: string | null };

export async function loginManager(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ipHash = loginIpHash(clientIp(await headers()));
  // Адрес заблокирован — пароль не проверяется вовсе; задержка та же, что при неверном.
  if (!(await withAnon((tx) => isLoginAllowed(tx, ipHash)))) {
    await loginFailDelay();
    return { error: 'Слишком много попыток. Подождите 15 минут и попробуйте снова.' };
  }
  const password = String(formData.get('password') ?? '');
  if (!(await verifyManagerPassword(password))) {
    // Неудача записывается до задержки: параллельные запросы видят её сразу.
    await withAnon((tx) => noteLoginFailure(tx, ipHash));
    await loginFailDelay();
    return { error: 'Неверный пароль' };
  }
  await startManagerSession();
  redirect('/month');
}

export async function logoutManager(): Promise<void> {
  await endManagerSession();
  redirect('/login');
}
