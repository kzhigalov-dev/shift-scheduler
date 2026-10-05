'use client';

import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EventTypeSelect } from '@/components/EventTypeSelect';
import { useRunAction } from '@/components/useRunAction';
import type { EventTypeOption } from '@/lib/eventTypes/types';
import { monthTitle } from '@/lib/month';
import { addPlanEventAction } from './actions';

const FIELD = 'h-11 lg:h-9';

export function AddPlanEventDialog({ month, types, variant = 'ghost' }: { month: string; types:EventTypeOption[]; variant?: 'ghost' | 'outline' }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} className="h-11 whitespace-nowrap lg:h-9"><Plus aria-hidden="true" />Мероприятие</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новое мероприятие</DialogTitle>
          <DialogDescription>Добавится столбцом в таблицу месяца {monthTitle(month).toLowerCase()}.</DialogDescription>
        </DialogHeader>
        {/* Форма монтируется заново при каждом открытии: старая ошибка и тип не переживают закрытие. */}
        <AddPlanEventForm month={month} types={types} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddPlanEventForm({ month, types, onDone }: { month: string; types:EventTypeOption[]; onDone: () => void }) {
  const [typeId,setTypeId] = useState(types[0]?.id??'');
  const [error,setError] = useState<string|null>(null);
  const [pending,run] = useRunAction();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();


  return (
    <form onSubmit={e=>{
      e.preventDefault();const form = new FormData(e.currentTarget);setError(null);
      run(async()=>{const result=await addPlanEventAction({error:null},form);setError(result.error);return result},'Мероприятие добавлено',onDone);
    }} className="grid gap-4">
      <input type="hidden" name="month" value={month} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('date')}>Дата</Label>
          <Input id={id('date')} name="date" type="date" required min={`${month}-01`}
            max={`${month}-${String(lastDay).padStart(2, '0')}`} className={FIELD} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('startTime')}>Начало</Label>
          <Input id={id('startTime')} name="startTime" type="time" required className={FIELD} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('arriveTime')}>Приход</Label>
          <Input id={id('arriveTime')} name="arriveTime" type="time" className={FIELD} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('type')}>Вид мероприятия</Label>
          <EventTypeSelect id={id('type')} options={types} value={typeId} onChange={setTypeId} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={id('concert')}>Название</Label>
          <Input id={id('concert')} name="concert" className={FIELD} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Пустой приход — автоматически по виду мероприятия.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="outline" className={FIELD}>Отмена</Button></DialogClose>
        <Button type="submit" disabled={pending||types.length===0} className={FIELD}>Добавить</Button>
      </DialogFooter>
    </form>
  );
}
