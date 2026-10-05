import { loginTarget } from '@/lib/auth/loginTarget';
import { LoginLayout } from '@/components/LoginLayout';
import { WebAppLogin } from './WebAppLogin';

/**
 * Telegram Mini App «Открыть приложение» (кнопка `web_app` в сообщениях бота работнику). GET ничего не меняет:
 * страница читает initData из адреса в браузере и входит POST-ом (`webAppLoginAction`), затем переходит
 * на `to` из белого списка. Открыта не из Telegram — «Откройте эту кнопку в Telegram».
 */
export default async function TgAppPage({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const to = loginTarget(typeof query.to === 'string' ? query.to : null);

  return (
    <LoginLayout>
      <WebAppLogin to={to} />
    </LoginLayout>
  );
}
