'use client';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Tags } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRunAction } from '@/components/useRunAction';
import { formatCount } from '@/lib/format';
import type { EventTypeSettings, TypeSlot } from '@/lib/eventTypes/types';
import { TypeDialog } from './TypeDialog';
import { ApplyTypeDialog } from './ApplyTypeDialog';
import { archiveEventTypeAction } from './actions';
const people = (n:number)=>formatCount(n,['человек','человека','человек']);
const total = (t:EventTypeSettings)=>t.slots.reduce((sum,s)=>sum+s.quantity,0);
/** Пункт «ДОЛЖНОСТЬ: N» не разрывается переносом — строка переносится только между пунктами. */
const composition = (t:EventTypeSettings)=>{
  const items = t.slots.filter(s=>s.quantity>0);
  if (items.length===0) return 'Должности не нужны.';
  return items.map((s,i)=><Fragment key={s.positionId}><span className="whitespace-nowrap">{s.positionName}:{'\u00a0'}{s.quantity}{i<items.length-1&&'\u00a0·'}</span>{i<items.length-1&&' '}</Fragment>);
};
export function TypeList({types,defaults,archived}: {types:EventTypeSettings[];defaults:TypeSlot[];archived:boolean}) {
  const [target,setTarget] = useState<EventTypeSettings|null>(null);
  const [pending,run] = useRunAction();
  const actions = (t:EventTypeSettings)=><div className="flex flex-wrap gap-2">
    <TypeDialog type={t} defaults={defaults} archived={archived} />
    {!archived&&<ApplyTypeDialog type={t} />}
    <Button variant="ghost" className="h-11 lg:h-9" disabled={pending}
      aria-label={`${archived?'Вернуть':'В архив'}: ${t.name}`}
      onClick={()=>archived?run(()=>archiveEventTypeAction(t.id,false),'Вид восстановлен'):setTarget(t)}>
      {archived?'Вернуть':'В архив'}
    </Button>
  </div>;
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Виды мероприятий" className="flex gap-2">
        <Button asChild variant={archived?'ghost':'secondary'} className="h-11 lg:h-9"><Link href="/event-types" aria-current={!archived?'page':undefined}>Действуют</Link></Button>
        <Button asChild variant={archived?'secondary':'ghost'} className="h-11 lg:h-9"><Link href="/event-types?tab=archived" aria-current={archived?'page':undefined}>Архив</Link></Button>
      </nav>
      <TypeDialog defaults={defaults} />
    </div>
    {types.length===0?<EmptyState icon={Tags} title={archived?'Архив пуст':'Нет активных видов'}
      description={archived?'Убранные виды появятся здесь.':'Добавьте вид или восстановите его из архива, чтобы создавать мероприятия.'} />:<>
      <div className="hidden rounded-lg border md:block" data-layout-scroll>
        <Table><TableHeader><TableRow><TableHead>Вид</TableHead><TableHead>Состав</TableHead><TableHead>Действия</TableHead></TableRow></TableHeader>
          <TableBody>{types.map(t=><TableRow key={t.id}>
            <TableCell className="max-w-64 whitespace-normal"><p className="break-words font-medium" data-allow-wrap>{t.name}</p>
              {archived&&<StatusBadge tone="neutral">В архиве</StatusBadge>}</TableCell>
            <TableCell className="max-w-sm whitespace-normal"><p className="font-medium">{people(total(t))}</p>
              <p className="text-xs text-muted-foreground" data-allow-wrap>{composition(t)}</p></TableCell>
            <TableCell>{actions(t)}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </div>
      <div className="grid gap-3 md:hidden">{types.map(t=><article key={t.id} data-contain className="min-w-0 rounded-lg border bg-card p-4">
        <h2 className="break-words font-semibold" data-allow-wrap>{t.name}</h2>
        {archived&&<StatusBadge tone="neutral">В архиве</StatusBadge>}
        <p className="mt-2 text-sm">{people(total(t))}</p>
        <p className="mt-1 text-xs text-muted-foreground" data-allow-wrap>{composition(t)}</p>
        <div className="mt-3">{actions(t)}</div>
      </article>)}</div>
    </>}
    <Dialog open={target!==null} onOpenChange={open=>{if(!open)setTarget(null)}}>
      <DialogContent className="sm:max-w-sm [&>*]:min-w-0"><DialogHeader className="min-w-0">
        <DialogTitle>Убрать вид в архив?</DialogTitle>
        <DialogDescription className="min-w-0 break-words" data-allow-wrap>«{target?.name}» исчезнет из выбора новых мероприятий. Существующие мероприятия и их состав сохранятся.</DialogDescription>
      </DialogHeader><DialogFooter>
        <DialogClose asChild><Button variant="outline" className="h-11 lg:h-9">Отмена</Button></DialogClose>
        <Button disabled={pending} className="h-11 lg:h-9" onClick={()=>{
          if(target)run(()=>archiveEventTypeAction(target.id,true),'Вид убран в архив',()=>setTarget(null));
        }}>В архив</Button>
      </DialogFooter></DialogContent>
    </Dialog>
  </div>;
}
