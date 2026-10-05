import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'danger' | 'warning' | 'neutral';

const TONES: Record<StatusTone, string> = {
  success: 'bg-status-success-bg text-status-success-fg',
  danger: 'bg-status-danger-bg text-status-danger-fg',
  warning: 'bg-status-warning-bg text-status-warning-fg',
  neutral: 'bg-status-neutral-bg text-status-neutral-fg',
};

/** Цветная метка статуса. Никогда не переносится и не сжимается. */
export function StatusBadge({ tone, children, title, className }: {
  tone: StatusTone; children: React.ReactNode; title?: string; className?: string;
}) {
  return (
    <span
      title={title}
      data-nowrap
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
