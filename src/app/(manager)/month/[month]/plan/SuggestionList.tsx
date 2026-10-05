'use client';

import type { Ref } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import type { Suggestion } from '@/lib/monthPlan/suggest';

/** Подсказки имён: общий список для ячейки таблицы и шторки места на телефоне. */
export function SuggestionList({ id, options, highlight, onHighlight, onChoose, size, listRef, style, className }: {
  id: string;
  options: Suggestion[];
  highlight: number;
  onHighlight: (index: number) => void;
  /** Выбор мышью или пальцем. */
  onChoose: (option: Suggestion) => void;
  size: 'sm' | 'lg';
  listRef?: Ref<HTMLUListElement>;
  style?: React.CSSProperties;
  className?: string;
}) {
  const item = size === 'lg' ? 'min-h-11' : 'min-h-9';
  return (
    <ul ref={listRef} id={id} role="listbox" aria-label="Подсказки" style={style} className={cn('text-sm', className)}>
      {options.length === 0 && (
        <li role="option" aria-selected={false} aria-disabled="true" className={cn('flex items-center px-2 text-muted-foreground', item)}>
          Никого не нашли.
        </li>
      )}
      {options.map((o, i) => (
        <li
          key={o.kind === 'new' ? 'new' : o.id}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === highlight}
          aria-disabled={o.kind === 'worker' && o.busy ? true : undefined}
          onMouseDown={(e) => { e.preventDefault(); onChoose(o); }}
          onMouseEnter={() => onHighlight(i)}
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1', item,
            i === highlight && 'bg-accent text-accent-foreground',
            o.kind === 'worker' && o.busy && 'cursor-not-allowed text-muted-foreground',
          )}
        >
          {o.kind === 'new' ? (
            <span className="min-w-0 truncate" title={o.name}>Добавить работника «{o.name}»</span>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate" title={o.fullName}>{o.fullName}</span>
              {o.signup && <StatusBadge tone="success">заявка</StatusBadge>}
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-nowrap>
                {o.busy ? `Уже: ${o.busy}` : o.shifts}
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
