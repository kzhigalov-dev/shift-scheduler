import { BRAND_MARK_PATH } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * Знак Анненкирхе — силуэт колокольни. Цвет — currentColor (задаётся text-*),
 * `size` — высота в px. Обычно квадрат (как иконка); `tight` — без боковых полей,
 * ширина по силуэту (для марки рядом с текстом). Декоративный: рядом всегда есть надпись.
 */
export function BrandMark({ size = 24, tight = false, className }: {
  size?: number; tight?: boolean; className?: string;
}) {
  return (
    <svg
      width={tight ? (size * 14) / 32 : size}
      height={size}
      viewBox={tight ? '9 0 14 32' : '0 0 32 32'}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    >
      <path d={BRAND_MARK_PATH} />
    </svg>
  );
}
