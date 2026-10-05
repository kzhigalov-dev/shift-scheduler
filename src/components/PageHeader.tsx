import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/** Заголовок экрана менеджера: крошки, заголовок, подзаголовок, действия справа. */
export function PageHeader({ title, subtitle, breadcrumbs, actions, clampTitle = true }: {
  title: string;
  /** true — заголовок до двух строк с «…» и title; false — целиком, длинные слова переносятся. */
  clampTitle?: boolean;
  subtitle?: React.ReactNode;
  breadcrumbs?: { href: string; label: string }[];
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-1">
      {breadcrumbs?.length ? (
        <nav aria-label="Навигация" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {breadcrumbs.map((b) => (
            <span key={b.href} className="flex min-w-0 items-center gap-1">
              <Link href={b.href} className="truncate hover:text-foreground">{b.label}</Link>
              <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 sm:flex-1 sm:basis-80">
          <h1
            title={clampTitle ? title : undefined}
            className={`break-words text-2xl font-semibold tracking-tight${clampTitle ? ' line-clamp-2' : ''}`}
          >
            {title}
          </h1>
          {subtitle ? <p className="mt-1 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
