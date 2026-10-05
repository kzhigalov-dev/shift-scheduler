'use client';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRunAction } from '@/components/useRunAction';
import { formatCount } from '@/lib/format';
import { MAX_DEFAULT_QUANTITY } from '@/lib/quantity';
import type { EventTypeSettings, TypeSlot } from '@/lib/eventTypes/types';
import { saveEventTypeAction } from './actions';
/** У архивного вида кнопки «Применить к мероприятиям» нет — о ней в описании не говорим. */
const SAVE_NOTE = 'Состав меняется у новых мероприятий. Ставки — также у уже созданных, которые ещё не начались. Прошлые суммы и отдельные ставки сохраняются.';
const RENAME_NOTE = 'Название сразу обновится и у существующих мероприятий';
const APPLY_NOTE = ', а их состав меняет только кнопка «Применить к мероприятиям»';
export function TypeDialog({type,defaults,archived=false}: {type?:EventTypeSettings;defaults:TypeSlot[];archived?:boolean}) {
  const [open,setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant={type?'outline':'default'} className={type?'h-11 lg:h-9':'h-11 hover:bg-primary lg:h-9'}
      aria-label={type?`Изменить вид: ${type.name}`:undefined}>{type?'Изменить':'Добавить вид'}</Button></DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{type?'Изменить вид':'Новый вид мероприятия'}</DialogTitle>
        <DialogDescription>{`${SAVE_NOTE} ${RENAME_NOTE}${archived ? '' : APPLY_NOTE}.`}</DialogDescription>
      </DialogHeader>
      <TypeForm type={type} slots={type?.slots??defaults} onSaved={()=>setOpen(false)} />
    </DialogContent>
  </Dialog>;
}
function TypeForm({type,slots,onSaved}: {type?:EventTypeSettings;slots:TypeSlot[];onSaved:()=>void}) {
  const uid = useId();
  const [error,setError] = useState<string|null>(null);
  const [pending,run] = useRunAction();
  const [quantities,setQuantities] = useState(()=>Object.fromEntries(slots.map(s=>[s.positionId,String(s.quantity)])));
  const valid = Object.values(quantities).every(v=>v.trim()!==''&&Number.isInteger(Number(v))&&Number(v)>=0&&Number(v)<=MAX_DEFAULT_QUANTITY);
  const total = Object.values(quantities).reduce((sum,v)=>sum+Number(v),0);
  return <form className="flex flex-col gap-4" onSubmit={e=>{
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    run(async()=>{const result=await saveEventTypeAction(form);setError(result.error);return result},'Вид сохранён',onSaved);
  }}>
    {type&&<input type="hidden" name="id" value={type.id} />}
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${uid}-name`}>Название</Label>
      <Input id={`${uid}-name`} name="name" defaultValue={type?.name??''} required className="h-11 lg:h-9" />
    </div>
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Состав и ставки по должностям</legend>
      {slots.map(s=><div key={s.positionId} className="grid grid-cols-2 items-center gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_5rem_7rem]">
        <Label htmlFor={`${uid}-${s.positionId}`} className="col-span-2 min-w-0 sm:col-span-1" data-allow-wrap>{s.positionName}</Label>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${uid}-${s.positionId}`} className="text-xs text-muted-foreground">Людей</Label>
          <Input id={`${uid}-${s.positionId}`} name={`quantity:${s.positionId}`} type="number" min={0} max={MAX_DEFAULT_QUANTITY}
            aria-label={`Людей: ${s.positionName}`} step={1} required value={quantities[s.positionId]}
            onChange={e=>setQuantities(prev=>({...prev,[s.positionId]:e.target.value}))} className="h-11 min-w-0 tabular-nums lg:h-9" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${uid}-rate-${s.positionId}`} className="text-xs text-muted-foreground">Ставка, ₽</Label>
          <Input id={`${uid}-rate-${s.positionId}`} name={`rate:${s.positionId}`} type="text" inputMode="numeric"
            aria-label={`Ставка вида: ${s.positionName}`} defaultValue={s.rate ?? ''} placeholder="Общая"
            className="h-11 min-w-0 tabular-nums lg:h-9" />
        </div>
      </div>)}
    </fieldset>
    <p className="text-sm font-medium">Всего: {valid?formatCount(total,['человек','человека','человек']):'—'}</p>
    <p className="text-xs text-muted-foreground">От 0 до 20 на каждую должность. Ноль — должность не нужна.</p>
    <p className="text-xs text-muted-foreground">Пустая ставка — общая ставка должности, затем ставка мероприятия. На отдельном мероприятии можно задать другую сумму.</p>
    {error&&<p role="alert" className="text-sm text-destructive" data-allow-wrap>{error}</p>}
    {/* Форма длиннее экрана телефона: кнопки прилипают к низу прокручиваемого окна. */}
    <DialogFooter className="sticky bottom-0 z-10 bg-popover">
      <DialogClose asChild><Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button></DialogClose>
      <Button disabled={pending} type="submit" className="h-11 hover:bg-primary lg:h-9">{pending?'Сохраняем…':'Сохранить'}</Button>
    </DialogFooter>
  </form>;
}
