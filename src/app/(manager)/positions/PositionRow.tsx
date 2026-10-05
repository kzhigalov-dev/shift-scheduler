'use client';

import { Fragment, useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { submitKeepingValues } from '@/components/submitKeepingValues';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { MAX_DEFAULT_QUANTITY } from '@/lib/quantity';
import { updatePositionAction, type ActionResult } from './actions';
import type { PositionRow as PositionRowData } from './operations';

const initialState: ActionResult = { error: null };

export function PositionRow({ position }: { position: PositionRowData }) {
  const formId = `position-${position.id}`;
  const [state, formAction, pending] = useActionState(updatePositionAction, initialState);

  // Каждый ответ сервера — новый объект, поэтому повторное сохранение тоже даёт уведомление.
  useEffect(() => {
    if (state !== initialState && !state.error) toast.success('Сохранено');
  }, [state]);

  return (
    <Fragment>
      <TableRow className={state.error ? 'border-b-0' : undefined}>
        <TableCell>
          <span title={position.name} className="block max-w-[240px] truncate">{position.name}</span>
        </TableCell>
        <TableCell>
          <Input
            form={formId}
            name="defaultQuantity"
            type="number"
            min={0}
            max={MAX_DEFAULT_QUANTITY}
            step={1}
            defaultValue={position.defaultQuantity}
            aria-label={`Людей на событии: ${position.name}`}
            className="h-11 w-20 tabular-nums lg:h-9"
          />
        </TableCell>
        <TableCell>
          <Input
            form={formId}
            name="defaultRate"
            type="text"
            inputMode="numeric"
            defaultValue={position.defaultRate ?? ''}
            placeholder="—"
            aria-label={`Ставка по умолчанию: ${position.name}`}
            className="h-11 w-[120px] tabular-nums lg:h-9"
          />
        </TableCell>
        <TableCell className="text-right">
          {/* Форма без вложенных полей: поля и кнопка ссылаются на неё через form=formId,
              чтобы оставаться в своих <td> и не нарушать структуру таблицы. */}
          <form id={formId} action={formAction} onSubmit={submitKeepingValues(formAction)}>
            <input type="hidden" name="id" value={position.id} />
          </form>
          <Button
            form={formId}
            type="submit"
            size="sm"
            variant="outline"
            disabled={pending}
            className="h-11 lg:h-9"
          >
            {pending ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </TableCell>
      </TableRow>
      {state.error && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="pt-0 whitespace-normal">
            <p role="alert" className="text-sm text-destructive">{state.error}</p>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
