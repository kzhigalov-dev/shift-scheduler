'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { suggest, type Suggestion } from '@/lib/monthPlan/suggest';
import type { PlanPerson } from '@/lib/monthPlan/plan';
import { SuggestionList } from './SuggestionList';

export type Direction = 'up' | 'down' | 'left' | 'right';

const LIST_WIDTH = 288;
const LIST_MAX_HEIGHT = 288;

/**
 * Ячейка «человек на должности». Кнопка — навигация стрелками, Enter/буква —
 * поле с подсказками, Delete — очистить. Список подсказок — в портале:
 * контейнер таблицы прокручивается и обрезал бы его.
 */
export function PersonCell({
  nav, person, active, pending, failed, workers, signups, shifts, busy, onPick, onAdd, onClear, move,
}: {
  nav: string;
  person: PlanPerson | null;
  active: boolean;
  pending: boolean;
  failed: boolean;
  workers: PlanPerson[];
  signups: ReadonlySet<string>;
  shifts: ReadonlyMap<string, number>;
  busy: ReadonlyMap<string, string>;
  onPick: (worker: PlanPerson) => void;
  onAdd: (name: string) => void;
  onClear: () => void;
  move: (direction: Direction) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Фокус без прокрутки: прокрутка закрыла бы список (см. ниже).
  useEffect(() => {
    if (editing) inputRef.current?.focus({ preventScroll: true });
  }, [editing]);

  // Прокрутка страницы или таблицы уводит ячейку из-под списка — закрываем.
  // Прокрутка самого списка подсказок — нет.
  useEffect(() => {
    if (!editing) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      setEditing(false);
    };
    const onResize = () => setEditing(false);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [editing]);

  // Подсвеченная подсказка всегда видна в списке.
  useEffect(() => {
    if (editing) document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [editing, highlight, listId]);

  if (!active) return <td className="h-9 w-40 min-w-40 max-w-40 border-b border-r bg-muted/50" aria-disabled="true" />;

  const options: Suggestion[] = editing ? suggest(query, { workers, signups, shifts, busy }) : [];

  function open(initial: string) {
    setAnchor(cellRef.current?.getBoundingClientRect() ?? null);
    setQuery(initial);
    setHighlight(0);
    setEditing(true);
  }

  /** Закрыть поле. refocus — вернуть фокус на ячейку; без него фокус переводит вызывающий. */
  function close(refocus: boolean) {
    setEditing(false);
    if (refocus) requestAnimationFrame(() => buttonRef.current?.focus());
  }

  /** Закрыть поле и перейти к соседней ячейке (после перерисовки — как в FieldCell). */
  function closeAndMove(direction: Direction) {
    close(false);
    requestAnimationFrame(() => move(direction));
  }

  /** true — выбор принят. Занятого на мероприятии выбрать нельзя. Поле не закрывает. */
  function choose(option: Suggestion | undefined): boolean {
    if (!option || (option.kind === 'worker' && option.busy)) return false;
    if (option.kind === 'new') onAdd(option.name);
    else onPick({ workerId: option.id, fullName: option.fullName });
    return true;
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.max(0, Math.min(h + 1, options.length - 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Enter') { e.preventDefault(); if (choose(options[highlight])) closeAndMove('down'); }
    else if (e.key === 'Tab') {
      // Tab не застревает: пустое поле, занятый или ненайденный — уходим без выбора.
      e.preventDefault();
      if (query.trim() !== '') choose(options[highlight]);
      closeAndMove(e.shiftKey ? 'left' : 'right');
    }
  }

  function onButtonKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    const arrows: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (arrows[e.key]) { e.preventDefault(); move(arrows[e.key]); }
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); open(''); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && person) { e.preventDefault(); onClear(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') { e.preventDefault(); open(e.key); }
  }

  const below = anchor ? anchor.bottom + 4 + LIST_MAX_HEIGHT <= window.innerHeight : true;
  const listStyle: React.CSSProperties | undefined = anchor ? {
    position: 'fixed',
    left: Math.min(anchor.left, window.innerWidth - LIST_WIDTH - 8),
    width: LIST_WIDTH,
    ...(below ? { top: anchor.bottom + 4 } : { bottom: window.innerHeight - anchor.top + 4 }),
  } : undefined;

  return (
    <td
      ref={cellRef}
      className={cn('relative h-9 w-40 min-w-40 max-w-40 border-b border-r p-0', failed && 'bg-status-danger-bg')}
    >
      {editing ? (
        <>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options[highlight] ? `${listId}-${highlight}` : undefined}
            aria-label="Имя работника"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={onInputKey}
            onBlur={() => setEditing(false)}
            className="h-9 w-full bg-background px-2 text-sm outline-none ring-2 ring-inset ring-ring"
          />
          {createPortal(
            <SuggestionList
              id={listId}
              options={options}
              highlight={highlight}
              onHighlight={setHighlight}
              onChoose={(o) => { if (choose(o)) close(true); }}
              size="sm"
              listRef={listRef}
              style={listStyle}
              className="z-50 max-h-72 overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
            />,
            document.body,
          )}
        </>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          data-cell={nav}
          onClick={() => open('')}
          onKeyDown={onButtonKey}
          aria-label={person ? `${person.fullName} — изменить` : 'Пустая ячейка — вписать человека'}
          title={person?.fullName}
          className={cn(
            'flex h-9 w-full items-center px-2 text-left text-sm outline-none hover:bg-muted/60',
            'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            pending && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{person?.fullName ?? ''}</span>
        </button>
      )}
    </td>
  );
}
