'use client';

import { ChevronDown, X } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { acceptSignupAction, rejectSignupAction } from './actions';
import type { PositionOption } from './PersonRow';
import { useRunAction } from '@/components/useRunAction';

type Signup = { signupId: string; workerId: string; fullName: string };

function SignupRow({
  eventId, signup, positions,
}: { eventId: string; signup: Signup; positions: PositionOption[] }) {
  const [pending, run] = useRunAction();

  function accept(positionId: string | null) {
    run(() => acceptSignupAction(eventId, signup.signupId, positionId), 'Принято');
  }

  function reject() {
    run(() => rejectSignupAction(eventId, signup.signupId), 'Заявка отклонена');
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span title={signup.fullName} className="min-w-0 flex-1 truncate">{signup.fullName}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm" disabled={pending} aria-label={`Принять заявку: ${signup.fullName}`}
            className="h-11 lg:h-8"
          >
            Принять
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          {positions.map((p) => (
            <DropdownMenuItem key={p.id} disabled={p.free <= 0} onSelect={() => accept(p.id)}>
              {p.name}
              {p.free <= 0 && <span className="ml-auto text-xs text-muted-foreground">мест нет</span>}
            </DropdownMenuItem>
          ))}
          {positions.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => accept(null)}>Без должности</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost" size="icon-sm" aria-label={`Отклонить заявку: ${signup.fullName}`} title="Отклонить"
        disabled={pending} onClick={reject} className="size-11 lg:size-8"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

export function SignupsPanel({
  eventId, signups, positions,
}: {
  eventId: string;
  signups: Signup[];
  positions: PositionOption[];
}) {
  return (
    <Card data-contain>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>Заявки</CardTitle>
        {signups.length > 0 && (
          <CardAction>
            <StatusBadge tone="warning">{signups.length}</StatusBadge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {signups.length === 0 ? (
          <p className="text-muted-foreground">Новых заявок нет.</p>
        ) : (
          signups.map((s) => (
            <SignupRow key={s.signupId} eventId={eventId} signup={s} positions={positions} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
