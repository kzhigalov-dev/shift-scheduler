import { cn } from '@/lib/utils';

export type IllustrationName = 'tower' | 'organ' | 'candle' | 'notes' | 'calendar' | 'empty';

/**
 * Собственные линейные иллюстрации в стиле знака (спецификация 2026-10-03-fill-screens-design.md):
 * линии 1.5 px при любом размере — `currentColor` (по умолчанию приглушённый текст), акцент — `--primary`
 * с прозрачностью, поэтому работают в обеих темах. Декоративные: `aria-hidden`, рядом всегда есть текст.
 * `size` — ширина в px (96–200), высота — 3/4 ширины.
 */
export function Illustration({ name, size = 120, className }: {
  name: IllustrationName; size?: number; className?: string;
}) {
  return (
    <svg
      width={size}
      height={(size * 3) / 4}
      viewBox="0 0 160 120"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-illustration={name}
      className={cn('shrink-0 text-muted-foreground [&_*]:[vector-effect:non-scaling-stroke]', className)}
    >
      {ART[name]}
    </svg>
  );
}

/** Акцент: заливка терракотой с прозрачностью, без обводки. */
const tint = (opacity: number) => ({ fill: 'var(--primary)', fillOpacity: opacity, stroke: 'none' });
const accent = { stroke: 'var(--primary)' };

const ART: Record<IllustrationName, React.ReactNode> = {
  // Колокольня Анненкирхе с крыльями-ротондами; от звонницы — волны звона.
  tower: (
    <>
      <path d="M62 62h36v46H62z" {...tint(0.12)} />
      <circle cx="80" cy="49" r="6" {...tint(0.3)} />
      <path d="M16 108h128" />
      <path d="M30 108V84h32M98 84h32v24" />
      <path d="M30 84q16-14 32 0M98 84q16-14 32 0" />
      <path d="M41 100v-5a3 3 0 0 1 6 0v5zM113 100v-5a3 3 0 0 1 6 0v5z" />
      <path d="M62 108V62h36v46" />
      <path d="M74 108v-12a6 6 0 0 1 12 0v12" />
      <path d="M58 62h44M67 62V36h26v26M64 36h32" />
      <circle cx="80" cy="49" r="6" />
      <path d="M71 36V22h18v14M76 36v-6a4 4 0 0 1 8 0v6" />
      <path d="M69 22h22M72 22q8-12 16 0M80 13V3" />
      <path d="M97 25q4 4 0 8M102 21q7 8 0 16" {...accent} />
    </>
  ),
  // Органные трубы: самая высокая в центре, «рты» — акцентом; ниже — пульт с клавиатурой.
  organ: (
    <>
      <path d="M75 18h10v64H75z" {...tint(0.14)} />
      <path d="M16 110h128" />
      <path d="M28 92h104v18H28zM40 101h80" />
      {[
        [31, 52], [42, 40], [53, 30], [64, 24], [75, 18], [86, 24], [97, 30], [108, 40], [119, 52],
      ].map(([x, top]) => (
        <g key={x}>
          <path d={`M${x} 84V${top + 4}a5 4 0 0 1 10 0V84M${x} 84l3 8h4l3-8`} />
          <path d={`M${x + 3} 76l2-3 2 3`} {...accent} />
        </g>
      ))}
    </>
  ),
  // Свечи на подносе; пламя и свет — акцентом.
  candle: (
    <>
      <circle cx="80" cy="34" r="20" {...tint(0.08)} />
      <path d="M80 20c8 10 7 19 0 22c-7-3-8-12 0-22z" {...tint(0.3)} />
      <path d="M80 20c8 10 7 19 0 22c-7-3-8-12 0-22z" {...accent} />
      <path d="M50 54c4 5 3 9 0 10c-3-1-4-5 0-10zM111 50c4 5 3 9 0 10c-3-1-4-5 0-10z" {...accent} />
      <path d="M70 98V50h20v48M80 50v-8M85 50v8q0 3 2 3" />
      <path d="M44 98V68h12v30M50 68v-4M105 98V64h12v34M111 64v-4" />
      <ellipse cx="80" cy="102" rx="46" ry="6" />
    </>
  ),
  // Нотный стан волной и ноты; головки нот — акцентом.
  notes: (
    <>
      {[40, 48, 56, 64, 72].map((y) => (
        <path key={y} d={`M12 ${y}C52 ${y - 8} 108 ${y + 8} 148 ${y}`} />
      ))}
      <ellipse cx="48" cy="64" rx="5" ry="3.5" transform="rotate(-20 48 64)" {...tint(0.6)} />
      <ellipse cx="88" cy="58" rx="5" ry="3.5" transform="rotate(-20 88 58)" {...tint(0.6)} />
      <ellipse cx="110" cy="52" rx="5" ry="3.5" transform="rotate(-20 110 52)" {...tint(0.6)} />
      <ellipse cx="48" cy="64" rx="5" ry="3.5" transform="rotate(-20 48 64)" {...accent} />
      <ellipse cx="88" cy="58" rx="5" ry="3.5" transform="rotate(-20 88 58)" {...accent} />
      <ellipse cx="110" cy="52" rx="5" ry="3.5" transform="rotate(-20 110 52)" {...accent} />
      <path d="M52.5 62V34M92.5 56V28l22-6v28" />
      <path d="M92.5 28l22-6M92.5 34l22-6" />
      <path d="M134 30V12l6 4" />
      <ellipse cx="130.5" cy="31" rx="4" ry="3" transform="rotate(-20 130.5 31)" {...tint(0.35)} />
      <ellipse cx="130.5" cy="31" rx="4" ry="3" transform="rotate(-20 130.5 31)" />
    </>
  ),
  // Лист календаря; сегодняшний день — акцентом.
  calendar: (
    <>
      <path d="M36 28a6 6 0 0 1 6-6h76a6 6 0 0 1 6 6v12H36z" {...tint(0.12)} />
      <rect x="36" y="22" width="88" height="82" rx="6" />
      <path d="M36 40h88M56 16v12M104 16v12" />
      {[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3, 4, 5].map((c) => {
        const today = r === 1 && c === 3;
        const x = 45 + c * 12.5;
        const y = 48 + r * 13;
        return today ? (
          <g key={`${r}-${c}`}>
            <rect x={x} y={y} width="8" height="8" rx="2" {...tint(0.55)} />
            <rect x={x - 2} y={y - 2} width="12" height="12" rx="3" {...accent} />
          </g>
        ) : (
          <rect key={`${r}-${c}`} x={x} y={y} width="8" height="8" rx="2" strokeOpacity={0.55} />
        );
      }))}
    </>
  ),
  // Пустая сцена: луч света, пюпитр с нотами и стул.
  empty: (
    <>
      <path d="M68 6L44 104h80L96 6z" {...tint(0.07)} />
      <path d="M12 104h136" />
      <path d="M62 48h40l-5 18H67z" {...tint(0.14)} />
      <path d="M62 48h40l-5 18H67zM70 54h22M69 59h20" />
      <path d="M82 66v38M72 104l10-12 10 12" />
      <path d="M30 104V58h6v26h22v20M36 84v20M30 92h28" />
    </>
  ),
};
