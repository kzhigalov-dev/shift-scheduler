'use client';

import { useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoney } from '@/lib/format';
import { MAX_DEFAULT_QUANTITY } from '@/lib/quantity';
import { setSlotAction } from './actions';
import { PersonRow, type PositionOption } from './PersonRow';
import type { SlotView } from './operations';
import { useRunAction } from '@/components/useRunAction';

/** Диалог «Настройки должности»: сколько мест на событии и ставка на этом концерте. */
function SlotDialog({
  eventId, slot, ratePlaceholder, open, onOpenChange,
}: {
  eventId: string;
  slot: SlotView;
  ratePlaceholder: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, run] = useRunAction();
  const quantityId = `quantity-${slot.positionId}`;
  const rateId = `slot-rate-${slot.positionId}`;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run(() => setSlotAction(eventId, slot.positionId, form), 'Сохранено', () => onOpenChange(false));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Настройки должности</DialogTitle>
          <DialogDescription className="break-words">{slot.name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={quantityId}>Мест на событии</Label>
            <Input
              id={quantityId}
              name="quantity"
              type="number"
              min={0}
              max={MAX_DEFAULT_QUANTITY}
              step={1}
              defaultValue={slot.quantity}
              className="h-11 lg:h-9"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={rateId}>Ставка на этом мероприятии, ₽</Label>
            <Input
              id={rateId}
              name="rate"
              type="text"
              inputMode="numeric"
              defaultValue={slot.rate ?? ''}
              placeholder={ratePlaceholder != null ? formatMoney(ratePlaceholder) : 'Ставка уточняется'}
              className="h-11 lg:h-9"
            />
            <p className="text-muted-foreground">
              {slot.typeRate != null ? `Пусто — ставка вида: ${formatMoney(slot.typeRate)}.` : 'Пусто — общая ставка должности, затем ставка мероприятия.'}
              {' '}Указанная сумма действует только здесь.
            </p>
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

/** Метка «занято/нужно»: зелёная при равенстве, красная при недоборе, жёлтая при переборе. */
function fillTone(occupied: number, quantity: number): StatusTone {
  if (quantity === 0 && occupied === 0) return 'neutral'; // должность на событии не нужна
  if (occupied === quantity) return 'success';
  return occupied < quantity ? 'danger' : 'warning';
}

function SlotCard({
  eventId, slot, positions, eventBaseRate,
}: {
  eventId: string;
  slot: SlotView;
  positions: PositionOption[];
  eventBaseRate: number | null;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const occupied = slot.people.length;
  const emptyCount = Math.max(slot.quantity - occupied, 0);
  const slotRatePlaceholder = slot.typeRate ?? slot.defaultRate ?? eventBaseRate;
  const personRatePlaceholder = slot.rate ?? slotRatePlaceholder;

  return (
    <Card size="sm" data-contain>
      <CardHeader>
        <CardTitle role="heading" aria-level={3} title={slot.name} className="min-w-0 truncate leading-11 lg:leading-8">
          {slot.name}
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          <StatusBadge
            tone={fillTone(occupied, slot.quantity)}
            title={`Занято ${occupied} из ${slot.quantity}`}
          >
            {occupied}/{slot.quantity}
          </StatusBadge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost" size="icon-sm" aria-label={`Меню должности ${slot.name}`}
                className="size-11 lg:size-8"
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>Настройки должности</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground" data-allow-wrap>
          {personRatePlaceholder === null ? 'Ставка уточняется.' : `${slot.rate !== null ? 'Отдельная ставка' : slot.typeRate != null ? 'Ставка вида' : 'Ставка'}: ${formatMoney(personRatePlaceholder)}.`}
        </p>
        {slot.people.map((person) => (
          <PersonRow
            key={person.workerId}
            eventId={eventId}
            person={person}
            positions={positions}
            currentPositionId={slot.positionId}
            ratePlaceholder={personRatePlaceholder}
          />
        ))}
        {Array.from({ length: emptyCount }, (_, i) => (
          <div
            key={`${slot.positionId}-empty-${i}`}
            className="rounded-md border border-dashed px-2 py-1.5 text-muted-foreground"
          >
            Свободное место
          </div>
        ))}
        {slot.quantity === 0 && occupied === 0 && (
          <p className="text-muted-foreground">Не нужна на событии.</p>
        )}
      </CardContent>
      <SlotDialog
        eventId={eventId}
        slot={slot}
        ratePlaceholder={slotRatePlaceholder}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </Card>
  );
}

export function PositionsPanel({
  eventId, slots, positions, eventBaseRate,
}: {
  eventId: string;
  slots: SlotView[];
  positions: PositionOption[];
  eventBaseRate: number | null;
}) {
  return (
    <div className="grid min-w-0 content-start gap-3 sm:grid-cols-2">
      {slots.map((slot) => (
        <SlotCard
          key={slot.positionId}
          eventId={eventId}
          slot={slot}
          positions={positions}
          eventBaseRate={eventBaseRate}
        />
      ))}
    </div>
  );
}
