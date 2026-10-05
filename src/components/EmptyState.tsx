import type { LucideIcon } from 'lucide-react';
import { Illustration, type IllustrationName } from './Illustration';

/**
 * Пустое состояние: иконка или иллюстрация, заголовок без точки, пояснение с точкой.
 * `illustration` — линейная картинка вместо иконки (там, где экран целиком пуст).
 * `titleAs` — тег заголовка: для экрана, у которого нет своего h1 (error.tsx), — 'h1'.
 */
export function EmptyState({ icon: Icon, illustration, title, description, action, titleAs: Title = 'p' }: {
  icon?: LucideIcon; illustration?: IllustrationName; title: string; description: React.ReactNode; action?: React.ReactNode;
  titleAs?: 'p' | 'h1' | 'h2';
}) {
  return (
    <div className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 text-center ${illustration ? 'py-8' : 'py-10'}`}>
      {illustration ? (
        <Illustration name={illustration} size={128} className="mb-1" />
      ) : Icon ? (
        <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      ) : null}
      <Title className="font-medium">{title}</Title>
      <p className="max-w-xs text-muted-foreground">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
