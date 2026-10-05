'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { suggest, type Suggestion } from '@/lib/monthPlan/suggest';
import { cn } from '@/lib/utils';
import type { PlanPerson } from '@/lib/monthPlan/plan';
import { SuggestionList } from './SuggestionList';

/**
 * Место на телефоне: поиск и подсказки в шторке снизу, «Очистить» — если занято.
 * Вызывающий монтирует шторку заново на каждое открытие (key): поиск начинается с пустого.
 */
export function PlaceSheet({
  open, onOpenChange, title, person, workers, signups, shifts, busy, onPick, onAdd, onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  person: PlanPerson | null;
  workers: PlanPerson[];
  signups: ReadonlySet<string>;
  shifts: ReadonlyMap<string, number>;
  busy: ReadonlyMap<string, string>;
  onPick: (worker: PlanPerson) => void;
  onAdd: (name: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const options: Suggestion[] = suggest(query, { workers, signups, shifts, busy });

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, listId]);

  function close() {
    onOpenChange(false);
  }

  function choose(option: Suggestion | undefined) {
    if (!option || (option.kind === 'worker' && option.busy)) return;
    if (option.kind === 'new') onAdd(option.name);
    else onPick({ workerId: option.id, fullName: option.fullName });
    close();
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh]"
        onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
      >
        <SheetHeader>
          <SheetTitle className="break-words">{title}</SheetTitle>
          <SheetDescription>{person ? `Сейчас: ${person.fullName}.` : 'Место свободно.'}</SheetDescription>
        </SheetHeader>
        <div className={cn('flex min-h-0 flex-col gap-2 px-4',
          // Без «Очистить» внизу — отступ до края (и выреза экрана), чтобы список не упирался.
          !person && 'pb-[calc(1rem+env(safe-area-inset-bottom))]')}>
          <Input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options[highlight] ? `${listId}-${highlight}` : undefined}
            aria-label="Имя работника"
            placeholder="Имя"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.max(0, Math.min(h + 1, options.length - 1))); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); choose(options[highlight]); }
            }}
            className="h-11 lg:h-9"
          />
          <SuggestionList
            id={listId} options={options} highlight={highlight} onHighlight={setHighlight}
            onChoose={choose} size="lg" className="max-h-[45dvh] overflow-auto"
          />
        </div>
        {person && (
          <SheetFooter className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Button type="button" variant="outline" className="h-11 w-full lg:h-9" onClick={() => { onClear(); close(); }}>
              Очистить
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
