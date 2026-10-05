'use client';
import { useRef, useState, useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useRunAction } from '@/components/useRunAction';
import { formatCount, formatDate } from '@/lib/format';
import type { TypeApplyPreview } from '@/lib/eventTypes/applyTemplate';
import { previewApplyTypeAction, applyTypeTemplateAction } from './actions';
const NBSP = '\u00a0';
const events = (n:number)=>formatCount(n,['мероприятие','мероприятия','мероприятий']);
/** Окно «Применить к мероприятиям»: предпросмотр при открытии, применение пересчитывает заново на сервере. */
export function ApplyTypeDialog({type}: {type:{id:string;name:string}}) {
  const [open,setOpen] = useState(false);
  const [preview,setPreview] = useState<TypeApplyPreview|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [loading,startLoading] = useTransition();
  const [pending,run] = useRunAction();
  // Ответ, пришедший после закрытия или повторного открытия окна, не показывается.
  const session = useRef(0);
  function load() {
    const mine = ++session.current;
    setPreview(null);setError(null);
    startLoading(async()=>{
      try {
        const result = await previewApplyTypeAction(type.id);
        if (mine!==session.current) return;
        setError(result.error);setPreview(result.preview);
      } catch (e) {
        unstable_rethrow(e);
        if (mine===session.current) setError('Не удалось загрузить изменения — попробуйте ещё раз');
      }
    });
  }
  const count = preview?.events.length ?? 0;
  return <Dialog open={open} onOpenChange={next=>{setOpen(next);if(next)load();else session.current+=1}}>
    <DialogTrigger asChild><Button variant="outline" className="h-11 lg:h-9"
      aria-label={`Применить к мероприятиям: ${type.name}`}>Применить к мероприятиям</Button></DialogTrigger>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg [&>*]:min-w-0">
      <DialogHeader className="min-w-0 pr-8">
        <DialogTitle className="break-words leading-snug" data-allow-wrap>Применить состав «{type.name}»?</DialogTitle>
        <DialogDescription>Будущие мероприятия этого вида получат состав из шаблона. Люди со смен не снимаются.</DialogDescription>
      </DialogHeader>
      {loading||(!preview&&!error)?<p className="text-muted-foreground">Загружаем изменения…</p>
        :error?<p role="alert" className="text-destructive" data-allow-wrap>{error}</p>
        :count===0?<p>Все будущие мероприятия уже соответствуют шаблону.</p>
        :<div role="region" aria-label="Изменения по мероприятиям" tabIndex={0} data-layout-scroll
          className="min-h-0 overflow-y-auto rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <ul className="divide-y">{preview?.events.map(e=><li key={e.eventId} className="flex flex-col gap-1 p-3">
            <p className="break-words font-medium" data-allow-wrap>
              {formatDate(e.date,{weekday:'short'})} · {e.startTime} · {e.concert ?? 'Без названия'}
            </p>
            <ul className="flex flex-col gap-0.5 text-muted-foreground">
              {e.changes.map(c=><li key={c.positionId} className="break-words" data-allow-wrap>{c.label}</li>)}
            </ul>
          </li>)}</ul>
        </div>}
      {count>0&&preview&&preview.unchanged>0&&<p className="text-muted-foreground">Без изменений: {events(preview.unchanged)}</p>}
      <DialogFooter>
        {count>0?<>
          <DialogClose asChild><Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button></DialogClose>
          <Button type="button" disabled={pending} className="h-11 lg:h-9" onClick={()=>run(()=>applyTypeTemplateAction(type.id),
            r=>r.applied>0?`Состав обновлён: ${events(r.applied)}`:'Состав уже соответствует шаблону',()=>setOpen(false))}>
            {pending?'Применяем…':`Применить к${NBSP}${count}`}
          </Button>
        </>:<DialogClose asChild><Button type="button" variant="outline" className="h-11 lg:h-9">Закрыть</Button></DialogClose>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
