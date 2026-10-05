'use client';

import { createContext, use } from 'react';
import { Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { DistributeDialog, useDistribution } from '@/app/(manager)/event/[id]/DistributeDialog';
import { previewDistributeMonthAction } from './actions';

const LABEL = 'Распределить по должностям';
const Open = createContext<(() => void) | null>(null);

/**
 * Окно распределения на месяц (мероприятия с сегодняшнего дня) — одно на шапку: открывается и кнопкой
 * шапки, и пунктом меню «⋯» (MoreMenu — серверный, пункт ему передаётся детьми).
 */
export function DistributeMonth({ month, children }: { month: string; children: React.ReactNode }) {
  const state = useDistribution(() => previewDistributeMonthAction(month));
  return (
    <Open value={state.start}>
      {children}
      <DistributeDialog mode="month" state={state} />
    </Open>
  );
}

export function DistributeMonthButton({ className }: { className?: string }) {
  const open = use(Open);
  return (
    <Button type="button" variant="outline" onClick={() => open?.()} className={cn('h-11 lg:h-9', className)}>
      <Shuffle aria-hidden="true" />{LABEL}
    </Button>
  );
}

export function DistributeMonthMenuItem({ className }: { className?: string }) {
  const open = use(Open);
  return (
    <DropdownMenuItem onSelect={() => open?.()} className={cn('h-11 lg:h-9', className)}>
      <Shuffle aria-hidden="true" />{LABEL}
    </DropdownMenuItem>
  );
}
