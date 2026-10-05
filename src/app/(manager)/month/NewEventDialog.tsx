'use client';

import type { EventTypeOption } from '@/lib/eventTypes/types';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { NewEventForm } from './NewEventForm';

/** Кнопка «Событие» и диалог «Новое событие» с формой. */
export function NewEventDialog({ types, variant = 'default' }: { types:EventTypeOption[]; variant?: 'default' | 'outline' }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={variant} className="h-11 lg:h-9">
          <Plus data-icon="inline-start" aria-hidden="true" />
          Событие
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новое событие</DialogTitle>
        </DialogHeader>
        <NewEventForm types={types} />
      </DialogContent>
    </Dialog>
  );
}
