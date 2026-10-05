'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PlanField } from '@/lib/monthPlan/planView';

const HINTS: Record<PlanField, string> = {
  startTime: 'Время в формате 20:00.',
  arriveTime: 'Пустое — автоматически по типу мероприятия.',
  baseRate: 'Целые рубли; пустое — ставка уточняется.',
};

/** Одно поле мероприятия на телефоне. Сохранение — по кнопке или Enter. */
export function FieldEditDialog({ open, onOpenChange, field, label, value, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: PlanField;
  label: string;
  value: string;
  onSave: (value: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{HINTS[field]}</DialogDescription>
        </DialogHeader>
        {/* Монтируется при каждом открытии — черновик не переживает закрытие. */}
        {open && (
          <FieldEditForm field={field} label={label} value={value} onSave={(v) => { onSave(v); onOpenChange(false); }} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldEditForm({ field, label, value, onSave }: {
  field: PlanField; label: string; value: string; onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const id = useId();
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          inputMode={field === 'baseRate' ? 'numeric' : 'text'} className="h-11 tabular-nums lg:h-9"
        />
      </div>
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="outline" className="h-11 lg:h-9">Отмена</Button></DialogClose>
        <Button type="submit" className="h-11 lg:h-9">Сохранить</Button>
      </DialogFooter>
    </form>
  );
}
