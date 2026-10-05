'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { currentDate } from '@/lib/month';
import type { MonthPlan, PlanColumn, PlanPerson } from '@/lib/monthPlan/plan';
import {
  AUTO_ARRIVE_TITLE, cellKey, fieldKey, pickEventId, PLAN_FIELDS, planFieldDisplay, planFieldValue,
  type Place, type PlanField,
} from '@/lib/monthPlan/planView';
import { cn } from '@/lib/utils';
import { FieldEditDialog } from './FieldEditDialog';
import { PlaceSheet } from './PlaceSheet';
import type { PlanEditing } from './usePlanEditing';

/** «Предыдущее / Следующее»: вид отключённой кнопки — и для aria-disabled. */
const NAV_BUTTON = 'h-11 aria-disabled:pointer-events-none aria-disabled:opacity-50';

/**
 * Шторка места — снимок на момент нажатия: пока шторка уезжает, её текст не меняется.
 * id — номер открытия: новая шторка монтируется заново, с пустым поиском.
 */
type SheetSnapshot = { id: number; col: PlanColumn; place: Place; person: PlanPerson | null; title: string };

/** Таблица расстановки на телефоне: полоса мероприятий и карточка выбранного. */
export function PlanCards({ plan, editing }: { plan: MonthPlan; editing: PlanEditing }) {
  const searchParams = useSearchParams();
  const selectedId = pickEventId(plan.columns, currentDate(), searchParams.get('event'));
  const index = plan.columns.findIndex((col) => col.eventId === selectedId);
  const c = plan.columns[index];
  const [sheet, setSheet] = useState<SheetSnapshot | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [field, setField] = useState<PlanField | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const chips = useRef(new Map<string, HTMLButtonElement>());
  const placeButtons = useRef(new Map<string, HTMLButtonElement>());

  // Выбранная кнопка — по центру полосы; только по горизонтали, страница не прокручивается.
  useEffect(() => {
    const box = strip.current;
    const chip = selectedId ? chips.current.get(selectedId) : undefined;
    if (!box || !chip) return;
    const b = box.getBoundingClientRect();
    const r = chip.getBoundingClientRect();
    box.scrollLeft += r.left + r.width / 2 - (b.left + b.width / 2);
  }, [selectedId]);

  if (!c) return null;

  /**
   * Выбор мероприятия — только адрес, без запроса к серверу: Next синхронизирует
   * history.replaceState с useSearchParams. Параметры — из текущего адреса, а не из рендера.
   */
  function select(eventId: string) {
    const params = new URLSearchParams(window.location.search);
    params.set('event', eventId);
    window.history.replaceState(null, '', `?${params.toString()}`);
  }

  /** Соседнее мероприятие от последнего выбранного: быстрые нажатия складываются. */
  function step(delta: number) {
    const current = pickEventId(plan.columns, currentDate(), new URLSearchParams(window.location.search).get('event'));
    const next = plan.columns[plan.columns.findIndex((col) => col.eventId === current) + delta];
    if (next) select(next.eventId);
  }

  function openPlace(p: Place) {
    setSheet((prev) => ({
      id: (prev?.id ?? 0) + 1, col: c, place: p, person: p.person, title: `${p.label} · ${formatDate(c.date)}`,
    }));
    setSheetOpen(true);
  }

  /** «✕»: очистить и вернуть фокус на место — сама кнопка «✕» исчезает. */
  function clearPlace(p: Place, key: string) {
    editing.clear(c, p.positionId, p.row);
    requestAnimationFrame(() => placeButtons.current.get(key)?.focus());
  }

  const fieldLabel = (f: PlanField) => PLAN_FIELDS.find(([x]) => x === f)?.[1] ?? '';

  return (
    <div className="flex flex-col gap-3">
      <div ref={strip} data-layout-scroll className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2 pb-1" role="list" aria-label="Мероприятия месяца">
          {plan.columns.map((col) => (
            <li key={col.eventId} className="shrink-0">
              <button
                ref={(el) => { if (el) chips.current.set(col.eventId, el); else chips.current.delete(col.eventId); }}
                type="button"
                aria-current={col.eventId === c.eventId ? 'true' : undefined}
                onClick={() => select(col.eventId)}
                className={cn(
                  'flex h-11 items-center gap-1.5 rounded-full border px-3 text-sm tabular-nums outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                  col.eventId === c.eventId ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted/60',
                )}
              >
                {editing.isFull(col.eventId) && (
                  <span
                    className={cn('size-2 rounded-full bg-status-success-fg',
                      col.eventId === c.eventId && 'ring-1 ring-primary-foreground')}
                    aria-hidden="true"
                  />
                )}
                <span className="whitespace-nowrap">{formatDate(col.date, { weekday: 'short' })} · {col.startTime}</span>
                {/* Точка видна перед датой, а читается после: имя кнопки начинается с даты. */}
                {editing.isFull(col.eventId) && <span className="sr-only">, все места заняты</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <section data-contain className="rounded-xl border bg-card">
        <header className="flex flex-col gap-1 border-b p-4">
          <p className="break-words text-xs text-muted-foreground" data-allow-wrap>
            {formatDate(c.date, { weekday: 'long' })}{` · ${c.eventTypeName}`}
          </p>
          <Link href={`/event/${c.eventId}`} className="break-words text-lg font-semibold hover:underline" data-allow-wrap>
            {c.concert ?? 'Без названия'}
          </Link>
          <div className="mt-1 flex flex-wrap gap-2">
            {PLAN_FIELDS.map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => setField(f)}
                title={f === 'arriveTime' && !c.arriveManual ? AUTO_ARRIVE_TITLE : undefined}
                className={cn(
                  'h-11 rounded-lg border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  editing.isFailed(fieldKey(c.eventId, f)) && 'bg-status-danger-bg',
                )}
              >
                <span className="text-muted-foreground">{label}</span>{'\u00a0'}
                <span className={f === 'arriveTime' && !c.arriveManual ? 'text-muted-foreground' : undefined}>
                  {planFieldDisplay(c, f)}
                </span>
              </button>
            ))}
          </div>
        </header>

        <ul className="divide-y">
          {editing.places(c.eventId).map((p) => {
            const key = cellKey(c.eventId, p.positionId, p.row);
            return (
              <li key={key} className={cn('flex items-center gap-2 px-4', editing.isFailed(key) && 'bg-status-danger-bg')}>
                <span className="w-28 shrink-0 truncate text-sm font-medium" title={p.label}>{p.label}</span>
                {/* Усечённое имя — рядом с кнопкой, не внутри: подпись кнопки должна помещаться
                    в её рамку целиком (проверка вёрстки), а кнопка поверх ловит нажатие по всей строке. */}
                <div
                  className={cn(
                    'relative flex h-12 min-w-0 flex-1 items-center',
                    !p.person && 'text-primary',
                    editing.isPending(key) && 'text-muted-foreground',
                  )}
                  title={p.person?.fullName}
                >
                  {/* Для чтения с экрана — подпись кнопки поверх; видимый текст её не дублирует. */}
                  {p.person
                    ? <span className="truncate" aria-hidden="true">{p.person.fullName}</span>
                    : <span className="flex items-center gap-1" aria-hidden="true"><Plus className="size-4" />Вписать</span>}
                  <button
                    ref={(el) => { if (el) placeButtons.current.set(key, el); else placeButtons.current.delete(key); }}
                    type="button"
                    onClick={() => openPlace(p)}
                    className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={p.person ? `${p.label}: ${p.person.fullName} — изменить` : `${p.label}: вписать человека`}
                  />
                </div>
                {p.person && (
                  <Button
                    type="button" variant="ghost" size="icon" className="size-11 shrink-0"
                    aria-label={`Убрать ${p.person.fullName}`}
                    onClick={() => clearPlace(p, key)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* aria-disabled, а не disabled: у крайнего мероприятия кнопка остаётся в фокусе,
          фокус не падает на body; нажатие ничего не делает — step() проверяет край. */}
      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" className={NAV_BUTTON} aria-disabled={index <= 0 || undefined}
          onClick={() => step(-1)}>
          <ChevronLeft aria-hidden="true" />Предыдущее
        </Button>
        <Button type="button" variant="outline" className={NAV_BUTTON}
          aria-disabled={index >= plan.columns.length - 1 || undefined} onClick={() => step(1)}>
          Следующее<ChevronRight aria-hidden="true" />
        </Button>
      </div>

      {sheet && (
        <PlaceSheet
          key={sheet.id}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={sheet.title}
          person={sheet.person}
          workers={plan.workers}
          signups={editing.signupsOf(sheet.col.eventId)}
          shifts={editing.shifts}
          busy={editing.busyOn(sheet.col.eventId)}
          onPick={(w) => editing.pick(sheet.col, sheet.place.positionId, sheet.place.row, w)}
          onAdd={(name) => editing.addWorker(sheet.col, sheet.place.positionId, sheet.place.row, name)}
          onClear={() => editing.clear(sheet.col, sheet.place.positionId, sheet.place.row)}
        />
      )}

      {field && (
        <FieldEditDialog
          open
          onOpenChange={(v) => { if (!v) setField(null); }}
          field={field}
          label={`${fieldLabel(field)}, ${formatDate(c.date)}`}
          value={planFieldValue(c, field)}
          onSave={(v) => { if (v.trim() !== planFieldValue(c, field)) editing.saveField(c, field, v); }}
        />
      )}
    </div>
  );
}
