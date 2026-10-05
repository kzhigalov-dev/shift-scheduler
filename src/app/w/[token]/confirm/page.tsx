import { redirect } from 'next/navigation';
import { roleToClose } from '@/lib/auth/session';
import { findWorkerByToken } from '@/lib/auth/workerLookup';
import { LoginLayout } from '@/components/LoginLayout';
import { LoginConfirm } from '@/components/LoginConfirm';
import { confirmPersonalLinkAction } from '@/app/tg/actions';

/**
 * Личная ссылка, когда в браузере уже другая роль (менеджер или другой работник): GET ничего не закрывает,
 * только «Войти как <Имя>?»; вход — POST кнопки (`confirmPersonalLinkAction`).
 */
export default async function PersonalLinkConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const worker = await findWorkerByToken(token);
  if (!worker) redirect('/login?error=link');

  return (
    <LoginLayout>
      <LoginConfirm name={worker.fullName} closes={await roleToClose(worker.fullName)} action={confirmPersonalLinkAction} fields={{ token }} />
    </LoginLayout>
  );
}
