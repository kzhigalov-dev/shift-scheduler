'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { assignAction } from './actions';
import type { PositionOption } from './PersonRow';
import { useRunAction } from '@/components/useRunAction';

type AvailableWorker = { id: string; fullName: string };

const NO_POSITION = 'none';
// Высота 44 px на телефоне, 36 px на ноутбуке; имя выбранного работника — одна строка с «…».
const TRIGGER = 'w-full data-[size=default]:h-11 lg:data-[size=default]:h-9 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate';

export function AddManualForm({
  eventId, available, positions,
}: {
  eventId: string;
  available: AvailableWorker[];
  positions: PositionOption[];
}) {
  const [workerId, setWorkerId] = useState('');
  const [positionId, setPositionId] = useState(NO_POSITION);
  const [pending, run] = useRunAction();
  const workerName = available.find((w) => w.id === workerId)?.fullName;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workerId) return;
    run(
      () => assignAction(eventId, workerId, positionId === NO_POSITION ? null : positionId),
      'Добавлено',
      () => {
        setWorkerId('');
        setPositionId(NO_POSITION);
      },
    );
  }

  return (
    <Card data-contain>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>Добавить человека</CardTitle>
      </CardHeader>
      <CardContent>
        {available.length === 0 ? (
          <p className="text-muted-foreground">Свободных работников нет.</p>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="add-worker">Работник</Label>
              <Select value={workerId} onValueChange={setWorkerId}>
                <SelectTrigger id="add-worker" title={workerName} className={TRIGGER}>
                  <SelectValue placeholder="Выберите работника" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="add-position">Должность</Label>
              <Select value={positionId} onValueChange={setPositionId}>
                <SelectTrigger id="add-position" className={TRIGGER}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_POSITION}>Без должности</SelectItem>
                  {positions.map((p) => (
                    <SelectItem key={p.id} value={p.id} disabled={p.free <= 0}>
                      {p.free <= 0 ? `${p.name} · мест нет` : p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={pending || !workerId} className="h-11 lg:h-9">
              Добавить
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
