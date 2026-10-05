'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Direction } from './PersonCell';

/**
 * Ячейка «Начало» / «Приход» / «Ставка»: Enter — правка, Enter/Tab/уход фокуса — сохранить,
 * Escape — отмена. failed — последняя запись не удалась (красная, как ячейка человека).
 */
export function FieldCell({ nav, value, display, label, title, muted, failed, onSave, move }: {
  nav: string;
  value: string;
  display: string;
  label: string;
  title?: string;
  muted?: boolean;
  failed?: boolean;
  onSave: (value: string) => void;
  move: (direction: Direction) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Правка уже завершена (сохранена или отменена). После Enter/Tab/Escape поле
  // исчезает, и его onBlur со старым draft не должен сохранить второй раз.
  const done = useRef(false);

  function edit(initial: string) {
    done.current = false;
    setDraft(initial);
  }

  function commit(next: Direction | null) {
    if (done.current) return;
    done.current = true;
    if (draft !== null && draft.trim() !== value) onSave(draft);
    setDraft(null);
    if (next) requestAnimationFrame(() => move(next));
  }

  function cancel() {
    done.current = true;
    setDraft(null);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  return (
    <td className={cn('h-9 w-40 min-w-40 max-w-40 border-b border-r p-0', failed && 'bg-status-danger-bg')}>
      {draft !== null ? (
        <input
          autoFocus
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit('down'); }
            else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? 'left' : 'right'); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          className="h-9 w-full bg-background px-2 text-sm tabular-nums outline-none ring-2 ring-inset ring-ring"
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          data-cell={nav}
          title={title}
          aria-label={`${label}: ${display} — изменить`}
          onClick={() => edit(value)}
          onKeyDown={(e) => {
            const arrows: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
            if (arrows[e.key]) { e.preventDefault(); move(arrows[e.key]); }
            else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); edit(value); }
            else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') { e.preventDefault(); edit(e.key); }
          }}
          className={cn(
            'flex h-9 w-full items-center px-2 text-left text-sm tabular-nums outline-none hover:bg-muted/60',
            'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            muted && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{display}</span>
        </button>
      )}
    </td>
  );
}
