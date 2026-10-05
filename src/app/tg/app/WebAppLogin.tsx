'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { webAppLoginAction } from '../actions';

type State = { kind: 'checking' } | { kind: 'outside' } | { kind: 'error'; message: string };

const FAILED = 'Не получилось войти. Нажмите «Открыть приложение» в боте ещё раз.';

/**
 * initData Telegram Mini App — из адреса: Telegram кладёт их в хеш (`#tgWebAppData=<initData>&tgWebAppVersion=…`).
 * Скрипт telegram.org не загружается (в России он может быть недоступен). Данные сразу убираются из адресной
 * строки и уходят на сервер (`webAppLoginAction`), он возвращает путь из белого списка.
 */
function readInitData(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return params.get('tgWebAppData');
}

export function WebAppLogin({ to }: { to: string }) {
  const [state, setState] = useState<State>({ kind: 'checking' });

  useEffect(() => {
    let active = true;
    const initData = readInitData();
    // Решение — после текущего рендера: состояние меняется из обработчика, а не синхронно в эффекте.
    void Promise.resolve().then(async () => {
      if (!initData) {
        if (active) setState({ kind: 'outside' });
        return;
      }
      try {
        const result = await webAppLoginAction(initData, to);
        if ('to' in result) window.location.replace(result.to);
        else if (active) setState({ kind: 'error', message: result.error });
      } catch {
        if (active) setState({ kind: 'error', message: FAILED });
      }
    });
    return () => { active = false; };
  }, [to]);

  return (
    <Card className="w-full max-w-[360px] [--card-spacing:--spacing(6)]">
      <CardContent className="flex flex-col gap-4">
        {state.kind === 'checking' ? (
          <p className="text-lg font-semibold" role="status">Входим…</p>
        ) : (
          <>
            <h1 className="text-lg font-semibold" data-allow-wrap>
              {state.kind === 'outside' ? 'Откройте эту кнопку в Telegram' : 'Не получилось войти'}
            </h1>
            <p className="text-sm" role={state.kind === 'error' ? 'alert' : undefined} data-allow-wrap>
              {state.kind === 'outside'
                ? 'Эта страница открывается кнопкой «Открыть приложение» в боте — тогда вход не нужен.'
                : state.message}
            </p>
            <Button asChild variant="outline" className="h-11 w-full md:h-9">
              <Link href="/login?for=worker">Другие способы входа</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
