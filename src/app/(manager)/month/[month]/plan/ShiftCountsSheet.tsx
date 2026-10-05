'use client';

import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { ShiftCountsList } from './ShiftCountsList';

/** «Смены в месяце» кнопкой — там, где нет места для панели справа (уже 1280 px). */
export function ShiftCountsSheet({ counts, names }: {
  counts: Array<[string, number]>; names: ReadonlyMap<string, string>;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className="h-11 lg:h-9"><Users aria-hidden="true" />Смены в месяце</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Смены в месяце</SheetTitle>
          <SheetDescription>Сколько смен у каждого в этом месяце.</SheetDescription>
        </SheetHeader>
        <div className="overflow-auto px-4 pb-4"><ShiftCountsList counts={counts} names={names} /></div>
      </SheetContent>
    </Sheet>
  );
}
