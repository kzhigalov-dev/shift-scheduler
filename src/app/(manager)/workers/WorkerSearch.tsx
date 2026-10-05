'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

const DEBOUNCE_MS = 300;

/**
 * Поиск по имени: пишет `?q=` в адрес (фильтрует сервер), сохраняя вкладку.
 * Обычная GET-форма — работает и без JS (Enter); с JS адрес обновляется по мере набора.
 */
export function WorkerSearch({ value, tab = 'active' }: {
  value: string;
  tab?: 'active' | 'archived';
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  // Таймер читает вкладку в момент срабатывания: за 300 мс её могли сменить.
  const tabRef = useRef(tab);
  const lastPushed = useRef(value);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // «Назад»/«Вперёд» меняют адрес без участия поля — подтягиваем значение из адреса.
  // Собственные переходы (lastPushed) не трогаем, чтобы не затирать набираемое.
  useEffect(() => {
    if (value === lastPushed.current) return;
    lastPushed.current = value;
    if (inputRef.current) inputRef.current.value = value;
  }, [value]);

  function go(query: string) {
    lastPushed.current = query.trim();
    const params = new URLSearchParams({ tab: tabRef.current });
    if (query.trim()) params.set('q', query.trim());
    startTransition(() => router.replace(`/workers?${params}`, { scroll: false }));
  }

  return (
    <form
      role="search"
      action="/workers"
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        clearTimeout(timer.current);
        go(String(new FormData(event.currentTarget).get('q') ?? ''));
      }}
      className="relative w-full sm:w-72"
    >
      <input type="hidden" name="tab" value={tab} />
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        name="q"
        defaultValue={value}
        placeholder="Поиск по имени"
        aria-label="Поиск по имени"
        autoComplete="off"
        onChange={(event) => {
          const query = event.currentTarget.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => go(query), DEBOUNCE_MS);
        }}
        className="h-11 pl-8 lg:h-9"
      />
    </form>
  );
}
