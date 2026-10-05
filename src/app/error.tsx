'use client'; // Границы ошибок — обязательно клиентский компонент

import { TriangleAlert } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';

export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // error.message на экран не выводим: сырые ошибки сервера — только в лог
  // (см. src/lib/errors.ts), пользователю — общий текст.
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <EmptyState
          icon={TriangleAlert}
          titleAs="h1"
          title="Что-то пошло не так"
          description="Попробуйте ещё раз. Если ошибка повторяется, напишите администратору."
          action={(
            <Button type="button" size="lg" onClick={() => retry()}>
              Попробовать ещё раз
            </Button>
          )}
        />
      </div>
    </main>
  );
}
