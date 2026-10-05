'use client';

import { useActionState, useCallback, useEffect, useId, useState, useTransition } from 'react';
import { Archive, Ellipsis, KeyRound, Pencil, RotateCcw } from 'lucide-react';
import { unstable_rethrow } from 'next/navigation';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/StatusBadge';
import { submitKeepingValues } from '@/components/submitKeepingValues';
import { useRunAction } from '@/components/useRunAction';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  updateWorkerAction, issueTokenAction, archiveWorkerAction, restoreWorkerAction,
  type ActionResult,
} from './actions';
import type { WorkerRow as WorkerRowData } from './operations';
import { TokenDialog } from './TokenDialog';

const initialState: ActionResult = { error: null };

/** Форма правки живёт внутри содержимого диалога: при каждом открытии — с чистым состоянием. */
function EditWorkerForm({ worker, onDone, onPendingChange }: {
  worker: WorkerRowData;
  onDone: () => void;
  /** Диалог не закрывается, пока идёт отправка. */
  onPendingChange: (pending: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(updateWorkerAction, initialState);
  const uid = useId();

  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);

  useEffect(() => {
    if (state !== initialState && !state.error) {
      toast.success('Сохранено');
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={formAction} onSubmit={submitKeepingValues(formAction)} className="grid gap-4">
      <input type="hidden" name="id" value={worker.id} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-fullName`}>ФИО</Label>
        <Input
          id={`${uid}-fullName`} name="fullName" type="text" required autoComplete="off"
          defaultValue={worker.fullName} className="h-11 lg:h-9"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-phone`}>Телефон</Label>
        <Input
          id={`${uid}-phone`} name="phone" type="tel" autoComplete="off"
          defaultValue={worker.phone ?? ''} className="h-11 lg:h-9"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button>
        </DialogClose>
        <Button type="submit" disabled={pending} className="h-11 lg:h-9">
          {pending ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Строка работника. Меню «⋯»: изменить, выдать/перевыпустить ссылку, в архив/вернуть.
 * Ошибки действий — всплывающим уведомлением (в строке для них нет места).
 */
export function WorkerRow({ worker }: { worker: WorkerRowData }) {
  const [actionPending, runAction] = useRunAction();
  const [issuePending, startIssue] = useTransition();
  const pending = actionPending || issuePending;
  const [editOpen, setEditOpen] = useState(false);
  const [editPending, setEditPending] = useState(false);
  const [reissueOpen, setReissueOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const closeEdit = useCallback(() => setEditOpen(false), []);

  function issueLink() {
    startIssue(async () => {
      try {
        const result = await issueTokenAction(worker.id);
        if (result.token) setIssuedToken(result.token);
        else toast.error(result.error ?? 'Не удалось выдать ссылку');
      } catch (error) {
        unstable_rethrow(error);
        toast.error('Не удалось выдать ссылку — попробуйте ещё раз');
      }
    });
  }

  const isActive = worker.status === 'active';

  return (
    <TableRow>
      <TableCell>
        <span title={worker.fullName} className="block max-w-[160px] truncate md:max-w-[280px]">
          {worker.fullName}
        </span>
        {/* На узком экране телефон уходит под имя — таблица помещается без прокрутки. */}
        <span className="block text-xs text-muted-foreground tabular-nums md:hidden">
          {worker.phone ?? '—'}
        </span>
      </TableCell>
      <TableCell className="hidden tabular-nums md:table-cell">
        {worker.phone ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell>
        {worker.hasLink
          ? <StatusBadge tone="success">Выдана</StatusBadge>
          : <StatusBadge tone="neutral">Не выдана</StatusBadge>}
      </TableCell>
      <TableCell className="w-14 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost" size="icon-sm" aria-label={`Действия: ${worker.fullName}`}
              disabled={pending} className="size-11 lg:size-9"
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-52">
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil aria-hidden="true" />
              Изменить
            </DropdownMenuItem>
            {isActive && (
              <DropdownMenuItem
                onSelect={() => (worker.hasLink ? setReissueOpen(true) : issueLink())}
              >
                <KeyRound aria-hidden="true" />
                {worker.hasLink ? 'Перевыпустить ссылку' : 'Выдать ссылку'}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {isActive ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => (worker.hasLink
                  ? setArchiveOpen(true)
                  : runAction(() => archiveWorkerAction(worker.id), 'Работник в архиве'))}
              >
                <Archive aria-hidden="true" />
                В архив
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => runAction(() => restoreWorkerAction(worker.id), 'Работник возвращён')}
              >
                <RotateCcw aria-hidden="true" />
                Вернуть
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={editOpen} onOpenChange={(open) => { if (!open && editPending) return; setEditOpen(open); }}>
          <DialogContent aria-describedby={undefined} className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Изменить работника</DialogTitle>
            </DialogHeader>
            <EditWorkerForm worker={worker} onDone={closeEdit} onPendingChange={setEditPending} />
          </DialogContent>
        </Dialog>

        <Dialog open={reissueOpen} onOpenChange={setReissueOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Перевыпустить ссылку?</DialogTitle>
              <DialogDescription>Старая ссылка перестанет работать. Telegram-уведомления и подписка на календарь отключатся — работнику нужно будет подключить Telegram и календарь заново.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button>
              </DialogClose>
              <Button
                type="button" disabled={pending} className="h-11 lg:h-9"
                onClick={() => { setReissueOpen(false); issueLink(); }}
              >
                Перевыпустить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Убрать в архив?</DialogTitle>
              <DialogDescription>
                Личная ссылка перестанет работать, Telegram и подписка на календарь отключатся. После возврата понадобится выдать новую ссылку, а работнику — заново подключить Telegram и календарь.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button>
              </DialogClose>
              <Button
                type="button" variant="destructive" disabled={pending} className="h-11 lg:h-9"
                onClick={() => runAction(
                  () => archiveWorkerAction(worker.id), 'Работник в архиве', () => setArchiveOpen(false),
                )}
              >
                В архив
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {issuedToken && (
          <TokenDialog token={issuedToken} onClose={() => setIssuedToken(null)} />
        )}
      </TableCell>
    </TableRow>
  );
}
