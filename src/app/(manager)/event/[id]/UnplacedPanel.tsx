import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Person } from './operations';
import { PersonRow, type PositionOption } from './PersonRow';
import { DistributeEventButton } from './DistributeDialog';

export function UnplacedPanel({
  eventId, people, positions, eventBaseRate, distributable,
}: {
  eventId: string;
  people: Person[];
  positions: PositionOption[];
  eventBaseRate: number | null;
  /** Есть кого и куда распределить: показать «Распределить по должностям». */
  distributable: boolean;
}) {
  return (
    <Card data-contain>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>Без должности</CardTitle>
        {people.length > 0 && (
          <CardAction>
            <StatusBadge tone="neutral">{people.length}</StatusBadge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {people.length === 0 ? (
          <p className="text-muted-foreground">Все расставлены.</p>
        ) : (
          people.map((person) => (
            <PersonRow
              key={person.workerId}
              eventId={eventId}
              person={person}
              positions={positions}
              currentPositionId={null}
              ratePlaceholder={eventBaseRate}
            />
          ))
        )}
        {people.length > 0 && distributable && <DistributeEventButton eventId={eventId} />}
      </CardContent>
    </Card>
  );
}
