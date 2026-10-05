'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { useRunAction } from '@/components/useRunAction';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';

type ConnectResult = { error: string | null; url: string | null };
type Result = { error: string | null };

const field = 'h-11 lg:h-9';

/**
 * Подключение чата: действие выдаёт одноразовую ссылку на бота, страница открывает её в новой вкладке.
 * Браузер с `noopener` всегда возвращает из `window.open` пустое значение, поэтому открылось окно или
 * его заблокировали, определить нельзя: ссылка «Открыть Telegram» остаётся на экране в любом случае.
 */
export function TelegramConnect({ connect }: { connect: () => Promise<ConnectResult> }) {
  const router = useRouter();
  const [pending, run] = useRunAction();
  const [checking, startCheck] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  // Ответ пришёл после ухода со страницы: вкладку не открываем.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  function start() {
    run(async () => {
      const result = await connect();
      if (result.error || !result.url) return { error: result.error ?? 'Не удалось подключить Telegram' };
      if (alive.current) {
        setUrl(result.url);
        window.open(result.url, '_blank', 'noopener');
      }
      return { error: null };
    }, null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" className={field} disabled={pending} onClick={start}>
          <Send aria-hidden="true" />Подключить Telegram
        </Button>
        {url ? (
          <Button asChild variant="outline" className={field}>
            <a href={url} target="_blank" rel="noreferrer">Открыть Telegram</a>
          </Button>
        ) : null}
        <Button
          type="button" variant="outline" className={field} disabled={checking}
          onClick={() => startCheck(() => router.refresh())}
        >
          Проверить
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Ссылка действует 15{' '}минут. После подключения обновите страницу.
      </p>
    </div>
  );
}

/**
 * «Отключить Telegram» с подтверждением; после успеха страница сама перерисуется без настроек.
 * `description` — что ещё случится (у работника закрываются входы из бота на других устройствах).
 */
export function TelegramDisconnect({ disconnect, description = 'Уведомления перестанут приходить.' }: {
  disconnect: () => Promise<Result>; description?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, run] = useRunAction();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className={field}>Отключить Telegram</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Отключить Telegram?</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" className={field}>Отмена</Button>
          </DialogClose>
          <Button
            type="button" variant="destructive" className={field} disabled={pending}
            onClick={() => run(disconnect, 'Telegram отключён', () => setOpen(false))}
          >
            Отключить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
