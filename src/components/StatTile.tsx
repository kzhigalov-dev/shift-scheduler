import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Показатель: значение крупно, подпись мелко под ним (подпись может переноситься).
 * `href` — плитка-ссылка со стрелкой; `className` — например, `col-span-2`.
 */
export function StatTile({ label, value, href, className }: {
  label: string; value: React.ReactNode; href?: string; className?: string;
}) {
  const body = (
    <>
      <span className="text-[15px] leading-tight font-semibold whitespace-nowrap tabular-nums sm:text-xl">{value}</span>
      <span className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-xs" data-allow-wrap>{label}</span>
    </>
  );
  const box = 'flex min-w-0 flex-col rounded-xl border bg-card px-2.5 py-2.5 sm:px-4 sm:py-3';
  if (!href) return <div data-contain className={cn(box, className)}>{body}</div>;
  return (
    <Link
      href={href}
      data-contain
      className={cn(
        box,
        'relative outline-none sm:pr-8 transition-colors hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      {body}
      <ChevronRight aria-hidden="true" className="absolute top-3.5 right-2.5 hidden size-4 text-muted-foreground sm:block" />
    </Link>
  );
}
