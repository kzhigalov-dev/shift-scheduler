'use client';

import { useFormStatus } from 'react-dom';
import { Button } from './ui/button';

/** Кнопка отправки формы с server action: пока запрос идёт — недоступна (без повторной отправки). */
export function SubmitButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {children}
    </Button>
  );
}
