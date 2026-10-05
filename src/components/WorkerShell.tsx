import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { withWorker } from '@/db/client';
import { requireWorker } from '@/lib/auth/session';
import { isTelegramConfigured } from '@/lib/telegram/config';
import { getLink } from '@/lib/telegram/links';
import { Button } from './ui/button';
import { BottomNav } from './BottomNav';
import { WorkerSidebar } from './WorkerSidebar';

/** Напоминание точки на колокольчике — в доступном имени и подсказке ссылки. */
const TELEGRAM_REMINDER = 'Подключите Telegram, чтобы получать уведомления.';

/**
 * Каркас экранов работника. Телефон: одна колонка и нижняя панель.
 * Монитор (от 1024 px): боковое меню, как у менеджера. `grid` — карточки
 * сеткой: 2 колонки от 1024 px, 3 от 1536 px. `toolbar` — строка над содержимым. Базовый размер текста — 15 px.
 * `aside` — колонка справа от 1280 px (сводки и подсказки; уже — не показывается): сетка карточек тогда
 * не шире двух колонок.
 */
export async function WorkerShell({ fullName, title, layout = 'stack', toolbar, aside, children }: {
  fullName: string; title: string; layout?: 'stack' | 'grid'; toolbar?: React.ReactNode;
  aside?: React.ReactNode; children: React.ReactNode;
}) {
  const worker = await requireWorker();
  const remind = isTelegramConfigured()
    && await withWorker(worker.id, async tx => (await getLink(tx, worker.id)) === null);
  const firstName = fullName.trim().split(/\s+/)[0];
  const greeting = firstName ? `Привет, ${firstName}` : 'Привет';
  const content = (
    <div className={cn(
      'min-w-0',
      layout === 'grid'
        ? cn('grid grid-cols-1 items-start gap-3 lg:grid-cols-2', !aside && '2xl:grid-cols-3')
        : 'flex flex-col gap-3',
    )}>
      {children}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-[15px]">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar lg:block">
        <div className="sticky top-0 h-screen"><WorkerSidebar /></div>
      </aside>
      <main className="mx-auto w-full min-w-0 max-w-md px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:max-w-[1200px] lg:px-8 lg:pb-8">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground" title={greeting}>{greeting}</p>
            <h1 className="mt-1 break-words text-2xl font-semibold" data-allow-wrap>{title}</h1>
          </div>
          <Button asChild variant="outline" className="relative h-11 w-11 shrink-0 p-0 lg:h-9 lg:w-9">
            {/* aria-label заменяет содержимое ссылки: напоминание — в самом имени, а не скрытым текстом. */}
            <Link href="/notifications" aria-label={remind ? `Уведомления. ${TELEGRAM_REMINDER}` : 'Уведомления'}
              title={remind ? TELEGRAM_REMINDER : 'Уведомления'}>
              <Bell aria-hidden="true" />
              {remind ? (
                <span aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-background" />
              ) : null}
            </Link>
          </Button>
        </header>
        {toolbar ? <div className="mb-3">{toolbar}</div> : null}
        {aside ? (
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start xl:gap-6">
            {content}
            <aside className="hidden xl:flex xl:flex-col xl:gap-3">{aside}</aside>
          </div>
        ) : content}
      </main>
      <BottomNav />
    </div>
  );
}
