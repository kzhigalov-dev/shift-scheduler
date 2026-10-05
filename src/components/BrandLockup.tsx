import { cn } from '@/lib/utils';
import { BrandMark } from './BrandMark';

const SIZES = {
  // Верхняя строка менеджера на телефоне (высота 48 px).
  sm: { mark: 26, name: 'text-base', sub: 'text-[11px]', gap: 'gap-2' },
  // Боковое меню.
  md: { mark: 32, name: 'text-[17px]', sub: 'text-xs', gap: 'gap-2.5' },
} as const;

/**
 * Марка: знак-колокольня + «Анненкирхе» (Lora 600) и мелко «смены».
 * Цвет знака — `markClassName` (по умолчанию text-primary).
 */
export function BrandLockup({ size = 'md', markClassName, className }: {
  size?: keyof typeof SIZES; markClassName?: string; className?: string;
}) {
  const s = SIZES[size];
  return (
    <div className={cn('flex min-w-0 items-center', s.gap, className)}>
      <BrandMark size={s.mark} tight className={cn('text-primary', markClassName)} />
      <div className="flex min-w-0 flex-col">
        <span className={cn('font-brand font-semibold leading-tight whitespace-nowrap', s.name)}>Анненкирхе</span>
        <span className={cn('leading-tight whitespace-nowrap text-muted-foreground', s.sub)}>смены</span>
      </div>
    </div>
  );
}
