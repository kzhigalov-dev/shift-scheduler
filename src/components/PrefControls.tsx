'use client';

import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Переключатель настройки: вся строка (не меньше 44 px) — область нажатия. */
export function PrefToggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="min-h-11 flex-1 cursor-pointer text-[15px] leading-snug" data-allow-wrap>
        {label}
      </Label>
    </div>
  );
}

/** Выбор значения настройки: подпись над полем на телефоне, в строке — от sm. */
export function PrefSelect({ label, value, options, onChange }: {
  label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <Label htmlFor={id} className="leading-snug" data-allow-wrap>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full data-[size=default]:h-11 sm:w-48 lg:data-[size=default]:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
