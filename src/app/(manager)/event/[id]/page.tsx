import { Card, CardContent } from '@/components/ui/card';
import { notFound } from 'next/navigation';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { isUuid } from '@/lib/ids';
import { currentDate } from '@/lib/month';
import { previewEventApply } from '@/lib/eventTypes/applyTemplate';
import { loadDistribution } from '@/lib/distribute/operations';
import { getEventCard } from './operations';
import { EventHeader } from './EventHeader';
import { SignupsPanel } from './SignupsPanel';
import { UnplacedPanel } from './UnplacedPanel';
import { AddManualForm } from './AddManualForm';
import { PositionsPanel } from './PositionsPanel';
import { TemplateNotice } from './TemplateNotice';

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireManager();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const data = await withManager(async (tx) => {
    const card = await getEventCard(tx, id);
    // Разница с шаблоном вида; у прошедшего мероприятия она всегда пуста.
    if (!card) return null;
    return {
      card,
      template: await previewEventApply(tx, id, currentDate()),
      // «Распределить по должностям» — если есть кого (без должности, активные, без запроса отмены) и куда (не АДМИН).
      distributable: (await loadDistribution(tx, { eventId: id })).length > 0,
    };
  });
  if (!data) notFound();
  const { card, template, distributable } = data;

  // Куда можно поставить человека: должности, нужные на этом событии. free — сколько мест осталось.
  const positions = card.slots
    .filter((s) => s.quantity > 0)
    .map((s) => ({ id: s.positionId, name: s.name, free: s.quantity - s.people.length }));

  return (
    <>
      <EventHeader event={card.event} types={card.eventTypeOptions} />

      {(card.event.program || card.event.performers) && (
        <Card data-contain className="mb-6">
          <CardContent className="flex flex-col gap-4" data-allow-wrap>
            {card.event.performers && <div><h2 className="font-medium">Исполнители</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm">{card.event.performers}</p></div>}
            {card.event.program && <details><summary className="cursor-pointer font-medium">Программа концерта</summary><p className="mt-3 whitespace-pre-wrap break-words text-sm">{card.event.program}</p></details>}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <SignupsPanel eventId={card.event.id} signups={card.signups} positions={positions} />
          <UnplacedPanel
            eventId={card.event.id}
            people={card.unplaced}
            positions={positions}
            eventBaseRate={card.event.baseRate}
            distributable={distributable}
          />
          <AddManualForm eventId={card.event.id} available={card.available} positions={positions} />
        </div>

        <section className="min-w-0">
          <h2 className="sr-only">Должности</h2>
          {template.changes.length > 0 && (
            <TemplateNotice
              eventId={card.event.id}
              typeName={template.typeName}
              labels={template.changes.map((c) => c.label)}
            />
          )}
          <PositionsPanel
            eventId={card.event.id}
            slots={card.slots}
            positions={positions}
            eventBaseRate={card.event.baseRate}
          />
        </section>
      </div>
    </>
  );
}
