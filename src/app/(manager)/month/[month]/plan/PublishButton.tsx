'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useRunAction } from '@/components/useRunAction';
import { pluralRu } from '@/lib/format';
import { publishMonthAction } from './actions';

export function PublishButton({ month, events }: { month: string; events: number }) {
  const [open, setOpen] = useState(false);
  const [pending, run] = useRunAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-11 lg:h-9"><Send aria-hidden="true" />Опубликовать</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Опубликовать месяц?</DialogTitle>
          <DialogDescription>
            Работники увидят {events} {pluralRu(events, ['мероприятие', 'мероприятия', 'мероприятий'])} и свои смены.
            Вернуть месяц в черновик нельзя.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" className="h-11 lg:h-9">Отмена</Button></DialogClose>
          <Button className="h-11 lg:h-9" disabled={pending}
            onClick={() => run(() => publishMonthAction(month), 'Месяц опубликован', () => setOpen(false))}>
            Опубликовать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
