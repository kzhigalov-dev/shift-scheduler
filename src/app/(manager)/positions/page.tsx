import { BriefcaseBusiness } from 'lucide-react';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { HintCard } from '@/components/HintCard';
import { WithAside } from '@/components/WithAside';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listPositions } from './operations';
import { PositionRow } from './PositionRow';

export default async function PositionsPage() {
  await requireManager();
  const positions = await withManager((tx) => listPositions(tx));

  const hint = (
    <HintCard
      title="Как это работает"
      illustration="organ"
      items={[
        'Начальный состав — сколько людей должности получит новый вид мероприятия.',
        'Ставка по умолчанию действует, если у места и человека своей нет.',
        'Пусто — платится ставка концерта.',
      ]}
    />
  );
  return (
    <>
      <PageHeader
        title="Должности"
        subtitle="Количество задаёт начальный состав нового вида мероприятия. Состав каждого вида меняется в «Видах мероприятий». Ставка действует, если у места и человека нет своей ставки; пусто — ставка концерта."
      />
      <WithAside width="readable" aside={hint}>
        {positions.length === 0 ? (
          <EmptyState
            icon={BriefcaseBusiness}
            title="Должностей пока нет"
            description="Список задаётся при настройке базы данных."
          />
        ) : (
          <div data-layout-scroll className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Должность</TableHead>
                  <TableHead>Начальный состав нового вида</TableHead>
                  <TableHead>Ставка по умолчанию</TableHead>
                  <TableHead><span className="sr-only">Действия</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((position) => (
                  <PositionRow key={position.id} position={position} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </WithAside>
    </>
  );
}
