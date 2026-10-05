'use client';

import { useRef, useState } from 'react';
import { requestCancelAction } from '../actions';
import { useRunAction } from '@/components/useRunAction';
import { StatusBadge } from '@/components/StatusBadge';
import { useMediaQuery } from '@/components/useMediaQuery';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { currentDate } from '@/lib/month';

const CANCEL_TITLE = 'Не сможете выйти?';
const CANCEL_TEXT = 'Менеджер получит запрос и решит, отпустить ли вас. До решения смена остаётся за вами.';

/**
 * «Не смогу» у своей смены: шторка на телефоне, диалог на мониторе; после запроса — метка «Отмена запрошена».
 * Прошедшую смену отменить нельзя: ничего не рисуется. Общая для карточки смены и «Ближайшей смены».
 */
export function ShiftCancel({ eventId, date, cancelRequested: initial }: {
  eventId: string; date: string; cancelRequested: boolean;
}) {
  const [cancelRequested, setCancelRequested] = useState(initial);
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, run] = useRunAction();
  const wide = useMediaQuery('(min-width: 64rem)');
  // Прошедшую смену отменить нельзя: запрос не имеет смысла.
  const past = date < currentDate();

  function sendRequest() {
    run(() => requestCancelAction(eventId), 'Запрос отправлен', () => {
      setCancelRequested(true);
      setOpen(false);
    });
  }

  function focusCancel(e: Event) {
    e.preventDefault();
    cancelRef.current?.focus();
  }

  // Общие для шторки и диалога кнопки; тексты — константами выше. Порядок разный:
  // в шторке действие сверху, в диалоге — как во всех диалогах: «Отмена», затем действие.
  const sendButton = (
    <Button
      type="button"
      variant="destructive"
      size="lg"
      className="w-full lg:h-9 lg:w-auto"
      disabled={pending}
      onClick={sendRequest}
    >
      Отправить запрос
    </Button>
  );
  const cancelButton = (
    <Button
      ref={cancelRef}
      type="button"
      variant="outline"
      size="lg"
      className="w-full lg:h-9 lg:w-auto"
      disabled={pending}
      onClick={() => setOpen(false)}
    >
      Отмена
    </Button>
  );

  if (past) return null;
  return (
    <>
      {cancelRequested ? (
        <StatusBadge tone="warning">Отмена запрошена</StatusBadge>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="px-3 text-destructive hover:text-destructive lg:h-9"
          onClick={() => setOpen(true)}
        >
          Не смогу
        </Button>
      )}

      {wide ? (
        <Dialog open={open} onOpenChange={(value) => !pending && setOpen(value)}>
          <DialogContent
            showCloseButton={false}
            className="text-[15px] sm:max-w-md"
            onOpenAutoFocus={focusCancel}
          >
            <DialogHeader>
              <DialogTitle className="text-lg">{CANCEL_TITLE}</DialogTitle>
              <DialogDescription className="text-[15px]">{CANCEL_TEXT}</DialogDescription>
            </DialogHeader>
            <DialogFooter>{cancelButton}{sendButton}</DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Sheet open={open} onOpenChange={(value) => !pending && setOpen(value)}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="mx-auto max-w-md text-[15px]"
            onOpenAutoFocus={focusCancel}
          >
            <SheetHeader>
              <SheetTitle className="text-lg">{CANCEL_TITLE}</SheetTitle>
              <SheetDescription className="text-[15px]">{CANCEL_TEXT}</SheetDescription>
            </SheetHeader>
            <SheetFooter className="pb-[calc(1rem+env(safe-area-inset-bottom))]">{sendButton}{cancelButton}</SheetFooter>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
