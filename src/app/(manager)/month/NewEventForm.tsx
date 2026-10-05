'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EventTypeSelect } from '@/components/EventTypeSelect';
import { useRunAction } from '@/components/useRunAction';
import type { EventTypeOption } from '@/lib/eventTypes/types';
import { createEventAction } from './actions';


/** Поле формы: подпись над полем; `wide` — на всю ширину сетки. */
function Field({ id, label, wide, children }: {
  id: string; label: string; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={wide ? 'flex flex-col gap-1.5 sm:col-span-2' : 'flex flex-col gap-1.5'}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Форма нового события. Живёт внутри `Dialog` (кнопка «Отмена» закрывает его). */
export function NewEventForm({types}: {types:EventTypeOption[]}) {
  const [error,setError] = useState<string|null>(null);
  const [pending,run] = useRunAction();
  const [typeId,setTypeId] = useState(types[0]?.id??'');
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const field = 'h-11 lg:h-9';

  return (
    <form onSubmit={e=>{
      e.preventDefault();const form = new FormData(e.currentTarget);setError(null);
      run(async()=>{const result=await createEventAction({error:null},form);setError(result.error);return result},'Событие создано');
    }} className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={id('date')} label="Дата">
          <Input id={id('date')} name="date" type="date" required className={field} />
        </Field>
        <Field id={id('startTime')} label="Начало">
          <Input id={id('startTime')} name="startTime" type="time" required className={field} />
        </Field>
        <Field id={id('arriveTime')} label="Приход">
          <Input id={id('arriveTime')} name="arriveTime" type="time" className={field} />
        </Field>
        <Field id={id('type')} label="Вид мероприятия">
          <EventTypeSelect id={id('type')} options={types} value={typeId} onChange={setTypeId} />
        </Field>
        <Field id={id('concert')} label="Концерт" wide>
          <Input id={id('concert')} name="concert" type="text" className={field} />
        </Field>
        <Field id={id('baseRate')} label="Ставка концерта, ₽">
          <Input id={id('baseRate')} name="baseRate" type="text" inputMode="numeric" className={field} />
        </Field>
        <Field id={id('comment')} label="Комментарий" wide>
          <textarea
            id={id('comment')}
            name="comment"
            rows={2}
            className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">Пустой приход — автоматически по виду мероприятия.</p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button>
        </DialogClose>
        <Button type="submit" disabled={pending||types.length===0} className="h-11 lg:h-9">
          {pending ? 'Создаём…' : 'Создать'}
        </Button>
      </DialogFooter>
    </form>
  );
}
