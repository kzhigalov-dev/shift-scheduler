import Link from 'next/link';
import { withWorker } from '@/db/client';
import { requireWorker } from '@/lib/auth/session';
import { EmptyState } from '@/components/EmptyState';
import { WorkerShell } from '@/components/WorkerShell';
import { Button } from '@/components/ui/button';
import { formatCount } from '@/lib/format';
import { currentDate } from '@/lib/month';
import { freeThisWeek } from '@/lib/summaries/worker';
import { isTelegramConfigured } from '@/lib/telegram/config';
import { getLink } from '@/lib/telegram/links';
import { parseWorkerPrefs } from '@/lib/telegram/prefs';
import { availableEvents } from '../queries';
import { AvailableCard } from './AvailableCard';

const PLACE_FORMS: [string, string, string] = ['место', 'места', 'мест'];

/** Пояснение пустого списка: обещать сообщение в Telegram — только если оно правда придёт. */
function emptyHint(telegram: 'notify' | 'off' | 'unlinked' | 'none'): { text: string; action: string | null } {
  if (telegram === 'notify') return { text: 'Мы напишем в Telegram, когда появятся.', action: null };
  if (telegram === 'off') return { text: 'Включите уведомления о свободных местах — мы напишем, когда появятся.', action: 'Уведомления' };
  if (telegram === 'unlinked') return { text: 'Подключите Telegram — мы напишем, когда появятся.', action: 'Подключить Telegram' };
  return { text: 'Новые появятся, когда менеджер добавит концерты.', action: null };
}

export default async function AvailablePage() {
  const worker = await requireWorker();
  const configured = isTelegramConfigured();
  const { events, link } = await withWorker(worker.id, async (tx) => ({
    events: await availableEvents(tx, worker.id),
    link: configured ? await getLink(tx, worker.id) : null,
  }));
  const free = freeThisWeek(events, currentDate());
  const hint = emptyHint(!configured ? 'none' : !link ? 'unlinked' : parseWorkerPrefs(link.prefs).free ? 'notify' : 'off');

  return (
    <WorkerShell
      fullName={worker.fullName}
      title="Свободные"
      layout={events.length === 0 ? 'stack' : 'grid'}
      toolbar={events.length > 0 ? (
        <p className="text-muted-foreground" data-allow-wrap>
          На этой неделе: <span className="font-medium text-foreground">{formatCount(free.week.length, PLACE_FORMS)}</span>,
          всего: <span className="font-medium text-foreground">{free.total}</span>
        </p>
      ) : undefined}
    >
      {events.length === 0 ? (
        <EmptyState
          illustration="empty"
          title="Свободных мест пока нет"
          description={hint.text}
          action={hint.action ? (
            <Button asChild variant="outline" size="lg">
              <Link href="/notifications">{hint.action}</Link>
            </Button>
          ) : undefined}
        />
      ) : (
        events.map((event) => (
          <AvailableCard key={`${event.eventId}:${event.signupStatus}`} event={event} />
        ))
      )}
    </WorkerShell>
  );
}
