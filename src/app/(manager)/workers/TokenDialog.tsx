'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

/**
 * Показывает выданный токен ровно один раз. Токен живёт только в состоянии
 * родителя и в этом диалоге — не логируется, не попадает в URL, закрытие
 * стирает его (родитель зануляет состояние).
 */
export function TokenDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const link = `${window.location.origin}/w/${token}`;

  const inputRef = useRef<HTMLInputElement>(null);

  /** Сначала Clipboard API; без него или при отказе — выделение поля и execCommand('copy'). */
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Ссылка скопирована');
      return;
    } catch {
      // Нет navigator.clipboard (небезопасный контекст) или отказ — пробуем запасной способ.
    }
    const input = inputRef.current;
    input?.focus();
    input?.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    if (copied) toast.success('Ссылка скопирована');
    else toast.error('Не удалось скопировать — ссылка выделена, скопируйте вручную');
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Личная ссылка</DialogTitle>
          <DialogDescription className="rounded-lg bg-status-warning-bg px-3 py-2 text-status-warning-fg">
            Ссылка — это вход без пароля. Отправьте её лично этому человеку. Второй раз она
            показана не будет — только перевыпуск.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="worker-link">Ссылка</Label>
          <Input
            id="worker-link"
            ref={inputRef}
            readOnly
            autoComplete="off"
            spellCheck={false}
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            className="h-11 lg:h-9"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={copy} className="h-11 lg:h-9">
            Скопировать
          </Button>
          <Button type="button" onClick={onClose} className="h-11 lg:h-9">Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
