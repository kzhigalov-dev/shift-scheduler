'use client';

import { useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { toast } from 'sonner';

type Result = { error: string | null };

type RunOptions = {
  /** Кнопка в тосте успеха, например «Отменить». */
  action?: { label: string; onClick: () => void };
  /** Вызывается при ошибке (после тоста ошибки). */
  onError?: () => void;
};

/**
 * Запуск серверного действия с уведомлением: `{ error: null }` — toast.success,
 * иначе toast.error с текстом ошибки. `pending` — пока действие идёт.
 * Служебные ошибки Next (redirect, notFound — например, протухшая сессия)
 * пробрасываются дальше и тоста не дают: переход выполняет сам Next.
 * `success = null` — успех без тоста (частые действия вроде ячейки таблицы); функция — текст
 * из результата действия (например, «Состав обновлён: 12 мероприятий»);
 * `options.action` — кнопка в тосте успеха, `options.onError` — обработчик ошибки.
 */
export function useRunAction() {
  const [pending, startTransition] = useTransition();

  function run<R extends Result>(
    work: () => Promise<R>, success: string | null | ((result: R) => string), onSuccess?: () => void, options?: RunOptions,
  ) {
    startTransition(async () => {
      try {
        const result = await work();
        if (result.error) {
          toast.error(result.error);
          options?.onError?.();
        } else {
          if (success !== null) {
            const text = typeof success === 'function' ? success(result) : success;
            toast.success(text, options?.action ? { action: options.action } : undefined);
          }
          onSuccess?.();
        }
      } catch (error) {
        unstable_rethrow(error);
        toast.error('Не удалось выполнить действие — попробуйте ещё раз');
        options?.onError?.();
      }
    });
  }

  return [pending, run] as const;
}
