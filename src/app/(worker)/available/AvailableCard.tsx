'use client';

import { useState } from 'react';
import { signupAction, withdrawAction } from '../actions';
import { useRunAction } from '@/components/useRunAction';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { formatDate, formatMoneyRange } from '@/lib/format';
import type { AvailableEvent } from '../queries';

export function AvailableCard({ event }: { event: AvailableEvent }) {
  const [status, setStatus] = useState(event.signupStatus);
  const [pending, run] = useRunAction();

  function signup() {
    run(() => signupAction(event.eventId), 'Заявка подана', () => setStatus('pending'));
  }

  function withdraw() {
    run(() => withdrawAction(event.eventId), 'Заявка отозвана', () => setStatus(null));
  }

  const title = event.concert ?? '—';

  return (
    <div data-contain className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">
        {formatDate(event.date, { weekday: 'short' })} · {event.startTime}
      </p>
      <p className="mt-1 line-clamp-2 break-words font-medium" title={title}>{title}</p>
      <p className="mt-1 text-muted-foreground tabular-nums">
        {event.rate !== null ? formatMoneyRange(event.rate) : 'Ставка уточняется'}
      </p>

      {status === null ? (
        <Button type="button" size="lg" className="mt-3 w-full" disabled={pending} onClick={signup}>
          Могу
        </Button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {status === 'pending' && (
            <>
              <StatusBadge tone="warning">Заявка подана</StatusBadge>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="ml-auto px-3"
                disabled={pending}
                onClick={withdraw}
              >
                Отозвать
              </Button>
            </>
          )}
          {status === 'accepted' && <StatusBadge tone="success">Заявка принята</StatusBadge>}
          {status === 'rejected' && <StatusBadge tone="neutral">Отклонена</StatusBadge>}
        </div>
      )}
    </div>
  );
}
