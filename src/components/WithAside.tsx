import { cn } from '@/lib/utils';

const WIDTHS = { full: '', readable: 'max-w-4xl', narrow: 'max-w-xl' } as const;

/**
 * Экран менеджера с колонкой справа (от 1280 px): подсказка «Как это работает» и т. п.
 * Колонка стоит сразу за содержимым. Уже 1280 px колонки нет. `width` — ширина содержимого:
 * `readable` — читаемая колонка (короткие таблицы), `narrow` — форма или карточки настроек.
 */
export function WithAside({ aside, width = 'full', children }: {
  aside: React.ReactNode; width?: keyof typeof WIDTHS; children: React.ReactNode;
}) {
  return (
    <div className="xl:flex xl:items-start xl:gap-8">
      <div className={cn('min-w-0 xl:flex-1', WIDTHS[width])}>{children}</div>
      <aside className="hidden w-64 shrink-0 xl:sticky xl:top-6 xl:flex xl:flex-col xl:gap-3">{aside}</aside>
    </div>
  );
}
