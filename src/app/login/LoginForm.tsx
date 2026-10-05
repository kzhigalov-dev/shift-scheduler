'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginManager, type LoginState } from './actions';

const initialState: LoginState = { error: null };

/** `autoFocus` — поле пароля сразу в фокусе (на свёрнутой форме под «Я менеджер» — нет). */
export function LoginForm({ autoFocus = true }: { autoFocus?: boolean }) {
  const [state, formAction, pending] = useActionState(loginManager, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Пароль менеджера</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoFocus={autoFocus}
          autoComplete="current-password"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? 'password-error' : undefined}
          className="h-11 md:h-9"
        />
        {state.error && (
          <p id="password-error" className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending} className="h-11 w-full md:h-9">
        Войти
      </Button>
    </form>
  );
}
