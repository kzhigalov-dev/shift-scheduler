import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronDown, Send } from 'lucide-react';
import { isManager, getCurrentWorker, type CurrentWorker } from '@/lib/auth/session';
import { botUsername } from '@/lib/telegram/config';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoginLayout } from '@/components/LoginLayout';
import { LoginForm } from './LoginForm';

type Params = { [key: string]: string | string[] | undefined };

/**
 * Экран работника: `?for=worker` (так уводит requireWorker без входа) и ошибки ссылок работника
 * (`error=tg` — ссылка из бота устарела, `error=tg-used` — уже использована, `error=link` — личная ссылка).
 */
const isWorkerScreen = (p: Params): boolean =>
  p.for === 'worker' || p.error === 'tg' || p.error === 'tg-used' || p.error === 'link';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  if (await isManager()) {
    // Менеджер открыл страницу работника — не уводим молча в «Месяц», а объясняем; просто /login — в «Месяц».
    const params = await searchParams;
    if (!isWorkerScreen(params)) redirect('/month');
    return (
      <LoginLayout>
        <ManagerOnWorkerPage error={params.error} />
      </LoginLayout>
    );
  }
  // Открытый кабинет работника не мешает войти менеджеру: форма показывается всегда,
  // иначе с одного браузера (открывали ссылку работника) до входа менеджера не добраться.
  const worker = await getCurrentWorker();
  const params = await searchParams;

  if (isWorkerScreen(params)) {
    return (
      <LoginLayout>
        <Card className="w-full max-w-[360px] [--card-spacing:--spacing(6)]">
          <CardContent className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold">Это кабинет работника</h1>
            <LinkError error={params.error} />
            <p className="text-sm">
              Откройте свою личную ссылку от менеджера или нажмите «Открыть приложение» в Telegram-боте @{botUsername()}.
            </p>
            {worker && <OpenWorker worker={worker} />}
            <Button asChild variant="outline" className="h-11 w-full md:h-9">
              <a href={`https://t.me/${botUsername()}`} rel="noopener noreferrer">
                <Send aria-hidden="true" />Открыть бота
              </a>
            </Button>
          </CardContent>
        </Card>

        <details className="group w-full max-w-[360px] rounded-lg border bg-card text-sm text-card-foreground">
          <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 font-medium select-none md:h-9 [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground transition-transform group-not-open:-rotate-90"
              aria-hidden="true"
            />
            Я менеджер
          </summary>
          <div className="px-4 pt-1 pb-4">
            <LoginForm autoFocus={false} />
          </div>
        </details>
      </LoginLayout>
    );
  }

  return (
    <LoginLayout>
      <Card className="w-full max-w-[360px] [--card-spacing:--spacing(6)]">
        <CardContent className="flex flex-col gap-5">
          <h1 className="text-lg font-semibold">Вход для менеджера</h1>

          {worker && <OpenWorker worker={worker} />}

          <LoginForm />

          <p className="text-xs text-muted-foreground">
            Работникам входить сюда не нужно — откройте свою личную ссылку.
          </p>
        </CardContent>
      </Card>
    </LoginLayout>
  );
}

const LINK_ERRORS: Record<string, string> = {
  tg: 'Ссылка для входа устарела — нажмите «Открыть приложение» в боте ещё раз.',
  // Повтор подтверждения после входа (вторая вкладка, повторная отправка формы) — не «устарела».
  'tg-used': 'Эта ссылка для входа уже использована — нажмите «Открыть приложение» в боте ещё раз.',
  link: 'Ссылка недействительна или устарела. Попросите у администратора новую.',
};

/** Ссылка работника не сработала: из бота (`tg`, `tg-used`) или личная (`link`). */
function LinkError({ error }: { error: Params['error'] }) {
  const message = typeof error === 'string' ? LINK_ERRORS[error] : undefined;
  if (!message) return null;
  return (
    <p className="w-full rounded-lg bg-status-warning-bg p-3 text-sm text-status-warning-fg" role="alert">
      {message}
    </p>
  );
}

function OpenWorker({ worker }: { worker: CurrentWorker }) {
  return (
    <p className="w-full rounded-lg bg-status-neutral-bg p-3 text-sm text-status-neutral-fg">
      Сейчас открыт кабинет работника «{worker.fullName}».{' '}
      <Link href="/shifts" className="font-medium underline underline-offset-2">Перейти к сменам</Link>
      . После входа менеджера кабинет работника в этом браузере закроется.
    </p>
  );
}

/** В этом браузере вошёл менеджер, а открыта страница работника: один браузер — одна роль. */
function ManagerOnWorkerPage({ error }: { error: Params['error'] }) {
  return (
    <Card className="w-full max-w-[360px] [--card-spacing:--spacing(6)]">
      <CardContent className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Вы вошли как менеджер</h1>
        <LinkError error={error} />
        <p className="text-sm">Это страница работника.</p>
        <Button asChild className="h-11 w-full md:h-9">
          <Link href="/month">Перейти в «Месяц»</Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          Кабинет работника откройте по его ссылке в другом браузере: вход работника здесь закроет вход менеджера.
        </p>
      </CardContent>
    </Card>
  );
}
