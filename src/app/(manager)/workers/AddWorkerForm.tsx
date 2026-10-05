'use client';

import { useActionState, useCallback, useEffect, useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { submitKeepingValues } from '@/components/submitKeepingValues';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createWorkerAction, type ActionResult } from './actions';

const initialState: ActionResult = { error: null };

/** Форма живёт внутри содержимого диалога: при каждом открытии — с чистым состоянием. */
function AddWorkerForm({ onDone }: { onDone: () => void }) {
  // Сам server action, без обёртки: только так форма работает и до гидратации
  // (POST, а не GET с именем и телефоном в адресе).
  const [state, formAction, pending] = useActionState(createWorkerAction, initialState);
  const uid = useId();

  // Успех — закрыть диалог; ошибка остаётся в форме вместе с введённым.
  useEffect(() => {
    if (state !== initialState && !state.error) {
      toast.success('Работник добавлен');
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={formAction} onSubmit={submitKeepingValues(formAction)} className="grid gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-fullName`}>ФИО</Label>
        <Input
          id={`${uid}-fullName`} name="fullName" type="text" required autoComplete="off"
          className="h-11 lg:h-9"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-phone`}>Телефон</Label>
        <Input
          id={`${uid}-phone`} name="phone" type="tel" autoComplete="off" className="h-11 lg:h-9"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button>
        </DialogClose>
        <Button type="submit" disabled={pending} className="h-11 lg:h-9">
          {pending ? 'Добавляем…' : 'Добавить'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Кнопка «Добавить» и диалог добавления работника. */
export function AddWorkerDialog({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} className="h-11 lg:h-9">
          <Plus data-icon="inline-start" aria-hidden="true" />
          Добавить
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый работник</DialogTitle>
        </DialogHeader>
        <AddWorkerForm onDone={close} />
      </DialogContent>
    </Dialog>
  );
}
