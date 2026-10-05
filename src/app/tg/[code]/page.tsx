import { redirect } from 'next/navigation';
import { getCurrentWorker, roleToClose } from '@/lib/auth/session';
import { loginCodeInfo } from '@/lib/auth/workerLookup';
import { loginTarget } from '@/lib/auth/loginTarget';
import { LoginLayout } from '@/components/LoginLayout';
import { LoginConfirm } from '@/components/LoginConfirm';
import { confirmLoginAction } from '../actions';

/**
 * Ссылка для входа из бота (`/tg/<код>?to=<путь>`). GET ничего не меняет: код не гасится, cookie и
 * сессии не трогаются (предпросмотр ссылки, повтор запроса, чужая ссылка) — только «Войти как <Имя>?».
 * Вход — POST кнопки (`confirmLoginAction`). Код уже использован, а в браузере открыт кабинет —
 * сразу туда; иначе — «уже использована»; истёк или неверный — «устарела».
 */
export default async function TgLoginPage({ params, searchParams }: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const to = loginTarget(typeof query.to === 'string' ? query.to : null);
  const info = await loginCodeInfo(code);
  if (info.state === 'used') redirect((await getCurrentWorker()) ? to : '/login?error=tg-used');
  if (info.state !== 'valid' || info.fullName === null) redirect('/login?error=tg');

  return (
    <LoginLayout>
      <LoginConfirm name={info.fullName} closes={await roleToClose(info.fullName)} action={confirmLoginAction} fields={{ code, to }} />
    </LoginLayout>
  );
}
