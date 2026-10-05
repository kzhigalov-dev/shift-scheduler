'use client';

import { useId, useState } from 'react';
import { Ellipsis, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EventTypeSelect } from '@/components/EventTypeSelect';
import { useRunAction } from '@/components/useRunAction';
import type { EventTypeOption } from '@/lib/eventTypes/types';
import { formatDate, formatMoney } from '@/lib/format';
import { updateEventAction, deleteEventAction } from './actions';
import type { EventCard } from './operations';

type EventData = EventCard['event'];

const NBSP = ' ';

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

/** Форма правки события: те же поля, что при создании; закрывает диалог при успехе. */
function EditEventForm({ event, types, onSaved }: { event: EventData; types:EventTypeOption[]; onSaved: () => void }) {
  const [error,setError] = useState<string|null>(null);
  const [pending,run] = useRunAction();
  const [typeId,setTypeId] = useState(event.eventTypeId);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const field = 'h-11 lg:h-9';

  return (
    <form onSubmit={e=>{
      e.preventDefault();const form=new FormData(e.currentTarget);setError(null);
      run(async()=>{const result=await updateEventAction({error:null},form);setError(result.error);return result},'Сохранено',onSaved);
    }} className="grid gap-4">
      <input type="hidden" name="eventId" value={event.id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={id('date')} label="Дата">
          <Input id={id('date')} name="date" type="date" required defaultValue={event.date} className={field} />
        </Field>
        <Field id={id('startTime')} label="Начало">
          <Input
            id={id('startTime')} name="startTime" type="time" required
            defaultValue={event.startTime} className={field}
          />
        </Field>
        <Field id={id('arriveTime')} label="Приход">
          <Input
            id={id('arriveTime')} name="arriveTime" type="time"
            defaultValue={event.arriveTime ?? ''} className={field}
          />
        </Field>
        <Field id={id('type')} label="Вид мероприятия">
          <EventTypeSelect id={id('type')} options={types} value={typeId} onChange={setTypeId} />
        </Field>
        <Field id={id('concert')} label="Концерт" wide>
          <Input
            id={id('concert')} name="concert" type="text"
            defaultValue={event.concert ?? ''} className={field}
          />
        </Field>
        <Field id={id('baseRate')} label="Ставка концерта, ₽">
          <Input
            id={id('baseRate')} name="baseRate" type="text" inputMode="numeric"
            defaultValue={event.baseRate ?? ''} className={field}
          />
        </Field>
        <Field id={id('comment')} label="Комментарий" wide>
          <textarea
            id={id('comment')}
            name="comment"
            rows={2}
            defaultValue={event.comment ?? ''}
            className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">Пустой приход — автоматически по виду мероприятия. Смена вида сохранит текущие места и назначения.</p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button>
        </DialogClose>
        <Button type="submit" disabled={pending} className="h-11 lg:h-9">
          {pending ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Шапка события: крошки, название, строка со временем и ставкой, «Изменить» и меню «⋯». */
export function EventHeader({ event, types }: { event: EventData; types:EventTypeOption[] }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting,runDelete] = useRunAction();
  function handleDelete() {
    runDelete(()=>deleteEventAction(event.id),null);
  }

  const subtitle = [
    event.eventTypeName,
    formatDate(event.date, { weekday: 'long' }),
    `Начало${NBSP}${event.startTime}`,
    event.arriveTime ? `Приход${NBSP}${event.arriveTime}` : null,
    event.baseRate != null ? formatMoney(event.baseRate) : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: `/month?month=${event.date.slice(0, 7)}`, label: 'Месяц' }]}
        title={event.concert ?? 'Без названия'}
        clampTitle={false}
        subtitle={<span className="block break-words tabular-nums" data-allow-wrap>{subtitle}</span>}
        actions={
          <>
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="h-11 lg:h-9">Изменить</Button>
              </DialogTrigger>
              <DialogContent
                aria-describedby={undefined}
                className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
              >
                <DialogHeader>
                  <DialogTitle>Изменить событие</DialogTitle>
                </DialogHeader>
                <EditEventForm event={event} types={types} onSaved={() => setEditOpen(false)} />
              </DialogContent>
            </Dialog>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline" size="icon" aria-label="Действия с событием"
                  className="size-11 lg:size-9"
                >
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-44">
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                  <Trash2 aria-hidden="true" />
                  Удалить событие
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить событие?</DialogTitle>
            <DialogDescription>Назначения и заявки тоже удалятся.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button>
            </DialogClose>
            <Button
              type="button" variant="destructive" disabled={deleting} onClick={handleDelete}
              className="h-11 lg:h-9"
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
