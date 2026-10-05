'use client';

import { useRef, useState } from 'react';
import { CalendarPlus, CalendarSync, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useRunAction } from '@/components/useRunAction';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';

type Urls = { https: string; webcal: string; google: string };
type Result = { error: string | null; urls: Urls | null; connected?: true };

/**
 * Подписка на календарь. Ссылка показывается один раз — сразу после
 * «Подключить» / «Новая ссылка»; в базе хранится только хеш ключа.
 */
export function CalendarSubscribeDialog({
  title, description, connected, connect, triggerLabel, triggerClassName, labelClassName, triggerTitle, icon = 'plus',
}: {
  title: string;
  description: string;
  connected: boolean;
  /** `replace = true` — только из подтверждения «Создать новую»: сервер не перевыпускает ключ молча. */
  connect: (replace: boolean) => Promise<Result>;
  triggerLabel: string;
  triggerClassName?: string;
  /**
   * Класс подписи кнопки. Для кнопки-иконки на узком экране: `sr-only sm:not-sr-only` прячет подпись
   * визуально, но оставляет её как имя кнопки для скринридера (вместе с `triggerClassName` вида `w-11 p-0 sm:w-auto`).
   */
  labelClassName?: string;
  /** Подсказка кнопки (для кнопки-иконки). */
  triggerTitle?: string;
  /**
   * Значок кнопки: строка, а не компонент — страница-сервер не может передать функцию клиентскому компоненту.
   * `plus` — календарь с плюсом, `sync` — календарь с обновлением (когда рядом уже есть «Новый месяц»).
   */
  icon?: 'plus' | 'sync';
}) {
  const TriggerIcon = icon === 'sync' ? CalendarSync : CalendarPlus;
  const [urls, setUrls] = useState<Urls | null>(null);
  // Локальная копия: проп обновится только после revalidate, а закрытое и снова открытое окно
  // не должно предлагать «Подключить» поверх уже выданного ключа.
  const [isConnected, setConnected] = useState(connected);
  const [confirming, setConfirming] = useState(false);
  // Счётчик запросов: результат, пришедший после закрытия окна, игнорируется.
  const session = useRef(0);
  const [pending, run] = useRunAction();
  const field = 'h-11 lg:h-9';

  function issue(replace: boolean) {
    const mine = session.current;
    run(async () => {
      const result = await connect(replace);
      // Ключ уже выдан (в другом окне): не «Подключить» по кругу, а состояние «подключён» с «Новой ссылкой».
      if (result.connected) { setConnected(true); setConfirming(false); }
      if (result.error || !result.urls) return { error: result.error ?? 'Не удалось подключить календарь' };
      setConnected(true);
      // Окно закрыли, пока шёл запрос: ссылку не показываем, но ключ уже выдан.
      if (mine === session.current) { setUrls(result.urls); setConfirming(false); }
      return { error: null };
    }, null);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Ссылка скопирована');
    } catch {
      toast.error('Не удалось скопировать — выделите ссылку вручную');
    }
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) { session.current += 1; setUrls(null); setConfirming(false); } }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className={cn(field, triggerClassName)} title={triggerTitle}>
          <TriggerIcon aria-hidden="true" /><span className={labelClassName}>{triggerLabel}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {urls ? (
          <div className="grid gap-2">
            <Button asChild className={field}><a href={urls.google} target="_blank" rel="noreferrer">Google Календарь</a></Button>
            <Button asChild variant="outline" className={field}><a href={urls.webcal}>iPhone и Mac</a></Button>
            <Button type="button" variant="outline" className={field} onClick={() => copy(urls.https)}>
              <Copy aria-hidden="true" />Скопировать ссылку
            </Button>
            <p className="break-all text-xs text-muted-foreground" data-allow-wrap>{urls.https}</p>
            <p className="text-xs text-muted-foreground">Ссылка показывается один раз. Если потеряется — создайте новую.</p>
          </div>
        ) : isConnected && !confirming ? (
          <div className="grid gap-3">
            <p>Календарь подключён.</p>
            <Button type="button" variant="outline" className={field} onClick={() => setConfirming(true)}>Новая ссылка</Button>
          </div>
        ) : isConnected ? (
          <div className="grid gap-3">
            <p>Старая ссылка перестанет работать: календарь, подключённый по ней, перестанет обновляться.</p>
            <DialogFooter>
              <Button type="button" variant="outline" className={field} onClick={() => setConfirming(false)}>Отмена</Button>
              <Button type="button" className={field} disabled={pending} onClick={() => issue(true)}>Создать новую</Button>
            </DialogFooter>
          </div>
        ) : (
          <Button type="button" className={field} disabled={pending} onClick={() => issue(false)}>Подключить</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
