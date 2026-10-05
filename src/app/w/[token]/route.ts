import { findWorkerByToken } from '@/lib/auth/workerLookup';
import { isSignedInAs } from '@/lib/auth/session';
import { noStoreRedirect } from '@/lib/http/redirect';

/**
 * Личная ссылка. GET ничего не меняет (L6 полного ревью безопасности): ни cookie, ни сессий — превью ссылок
 * в мессенджерах и чужая страница не входят в кабинет. Браузер уже вошёл этим работником — сразу в приложение;
 * иначе — «Войти как <Имя>?» (`/w/<токен>/confirm`), вход — POST кнопки: токен ссылки меняется на сессию.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const worker = await findWorkerByToken(token);
  if (!worker) return noStoreRedirect('/login?error=link');
  if (await isSignedInAs(worker.id)) return noStoreRedirect('/shifts');
  return noStoreRedirect(`/w/${encodeURIComponent(token)}/confirm`);
}
