'use client';

import { useState } from 'react';
import { Ellipsis, Trash2 } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoney } from '@/lib/format';
import {
  assignAction, unassignAction, resolveCancelAction, setPersonRateAction,
} from './actions';
import type { Person } from './operations';
import { useRunAction } from '@/components/useRunAction';

/** Должность, на которую можно поставить человека; free — сколько мест осталось. */
export type PositionOption = { id: string; name: string; free: number };

/** Диалог личной ставки: пустое поле — ставка должности. */
function RateDialog({
  eventId, person, ratePlaceholder, open, onOpenChange,
}: {
  eventId: string;
  person: Person;
  ratePlaceholder: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, run] = useRunAction();
  const inputId = `rate-${person.workerId}`;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run(() => setPersonRateAction(eventId, person.workerId, form), 'Сохранено', () => onOpenChange(false));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Личная ставка</DialogTitle>
          <DialogDescription className="break-words">{person.fullName}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>Ставка, ₽</Label>
            <Input
              id={inputId}
              name="rate"
              type="text"
              inputMode="numeric"
              defaultValue={person.personRate ?? ''}
              placeholder={ratePlaceholder != null ? formatMoney(ratePlaceholder) : 'Ставка уточняется'}
              className="h-11 lg:h-9"
            />
            <p className="text-muted-foreground">Пусто — возьмётся действующая ставка.</p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button>
            </DialogClose>
            <Button type="submit" disabled={pending} className="h-11 lg:h-9">Сохранить</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Строка человека — в «Без должности» и в карточке должности.
 * Меню «⋯»: перенести, личная ставка, снять с события.
 */
export function PersonRow({
  eventId, person, positions, currentPositionId, ratePlaceholder,
}: {
  eventId: string;
  person: Person;
  positions: PositionOption[];
  currentPositionId: string | null;
  /** Ставка, которая действует, пока личная не задана; null — ставка не задана нигде. */
  ratePlaceholder: number | null;
}) {
  const [pending, run] = useRunAction();
  const [rateOpen, setRateOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const targets = positions.filter((p) => p.id !== currentPositionId);
  // Переносить есть куда: на другую должность или (если человек на должности) в «Без должности».
  const canMove = targets.length > 0 || currentPositionId !== null;

  function move(positionId: string | null) {
    run(() => assignAction(eventId, person.workerId, positionId), 'Перенесено');
  }

  function remove() {
    run(() => unassignAction(eventId, person.workerId), 'Снят с события', () => setRemoveOpen(false));
  }

  function resolveCancel(approve: boolean) {
    run(
      () => resolveCancelAction(eventId, person.workerId, approve),
      approve ? 'Снят с события' : 'Остаётся на событии',
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border px-2 py-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <span title={person.fullName} className="min-w-0 truncate">{person.fullName}</span>
        {person.personRate != null && (
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
            · {formatMoney(person.personRate)}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost" size="icon-sm" aria-label={`Действия: ${person.fullName}`}
              disabled={pending} className="ml-auto size-11 lg:size-8"
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            {canMove && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Перенести</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="min-w-40">
                    {targets.map((p) => (
                      <DropdownMenuItem key={p.id} disabled={p.free <= 0} onSelect={() => move(p.id)}>
                        {p.name}
                        {p.free <= 0 && <span className="ml-auto text-xs text-muted-foreground">мест нет</span>}
                      </DropdownMenuItem>
                    ))}
                    {currentPositionId !== null && (
                      <>
                        {targets.length > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuItem onSelect={() => move(null)}>Без должности</DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem onSelect={() => setRateOpen(true)}>Личная ставка</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>
              <Trash2 aria-hidden="true" />
              Снять с события
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {person.cancelRequested && (
        <div className="flex flex-col items-start gap-1.5 pb-1.5">
          <StatusBadge tone="warning">Отмена запрошена</StatusBadge>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm" variant="outline" disabled={pending} onClick={() => resolveCancel(true)}
              className="h-11 px-2 lg:h-8"
            >
              Отпустить
            </Button>
            <Button
              size="sm" variant="outline" disabled={pending} onClick={() => resolveCancel(false)}
              className="h-11 px-2 lg:h-8"
            >
              Оставить
            </Button>
          </div>
        </div>
      )}
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Снять с события?</DialogTitle>
            <DialogDescription>Назначение и личная ставка этого человека будут удалены.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button>
            </DialogClose>
            <Button
              type="button" variant="destructive" disabled={pending} onClick={remove}
              className="h-11 lg:h-9"
            >
              Снять
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RateDialog
        eventId={eventId}
        person={person}
        ratePlaceholder={ratePlaceholder}
        open={rateOpen}
        onOpenChange={setRateOpen}
      />
    </div>
  );
}
