import Link from 'next/link';
import { Archive, SearchX, Users } from 'lucide-react';
import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listWorkers, workerStats } from './operations';
import { HintCard } from '@/components/HintCard';
import { StatTile } from '@/components/StatTile';
import { WithAside } from '@/components/WithAside';
import { WorkerRow } from './WorkerRow';
import { AddWorkerDialog } from './AddWorkerForm';
import { WorkerSearch } from './WorkerSearch';

/** Сравнение имён без учёта регистра, ё/е и лишних пробелов. */
function searchKey(value: string): string {
  return value.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function WorkersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; q?: string | string[] }>;
}) {
  await requireManager();
  const params = await searchParams;
  const status = first(params.tab) === 'archived' ? 'archived' : 'active';
  const query = first(params.q).trim();
  const needle = searchKey(query);
  const [workers, stats] = await withManager(async (tx) => [await listWorkers(tx), await workerStats(tx)] as const);
  const shown = workers.filter(
    (w) => w.status === status && (!needle || searchKey(w.fullName).includes(needle)),
  );

  const tabHref = (tab: 'active' | 'archived') =>
    `/workers?tab=${tab}${query ? `&q=${encodeURIComponent(query)}` : ''}`;

  return (
    <>
      <PageHeader title="Работники" actions={<AddWorkerDialog />} />

      <WithAside aside={<LinkHint />}>
        {/* Телефон: одной строкой, чтобы не отодвигать список; шире — плитками. */}
        <p className="mb-3 text-sm text-muted-foreground tabular-nums sm:hidden" data-allow-wrap>
          {'Работают\u00a0'}<b className="font-semibold text-foreground">{stats.active}</b>
          {' · в\u00a0архиве\u00a0'}<b className="font-semibold text-foreground">{stats.archived}</b>
          {' · с\u00a0Telegram\u00a0'}<b className="font-semibold text-foreground">{stats.telegram}</b>
          {' · с\u00a0календарём\u00a0'}<b className="font-semibold text-foreground">{stats.calendar}</b>
        </p>
        <div className="mb-4 hidden grid-cols-4 gap-3 sm:grid">
          <StatTile label="Работают" value={stats.active} />
          <StatTile label="В архиве" value={stats.archived} />
          <StatTile label="С Telegram" value={stats.telegram} />
          <StatTile label="С календарём" value={stats.calendar} />
        </div>

        <Tabs value={status} className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList aria-label="Список работников">
              <TabsTrigger value="active" asChild>
                <Link href={tabHref('active')} className="px-3">Работают</Link>
              </TabsTrigger>
              <TabsTrigger value="archived" asChild>
                <Link href={tabHref('archived')} className="px-3">Архив</Link>
              </TabsTrigger>
            </TabsList>
            <WorkerSearch value={query} tab={status} />
          </div>

          <TabsContent value={status}>
            {shown.length === 0 ? (
              query ? (
                <EmptyState
                  icon={SearchX}
                  title="Никого не найдено"
                  description="Попробуйте другое имя или очистите поиск."
                />
              ) : status === 'active' ? (
                <EmptyState
                  icon={Users}
                  title="Работников пока нет"
                  description="Добавьте работника или импортируйте таблицу."
                  action={<AddWorkerDialog variant="outline" />}
                />
              ) : (
                <EmptyState
                  icon={Archive}
                  title="В архиве никого нет"
                  description="Сюда попадают работники, убранные из списка."
                />
              )
            ) : (
              <div data-layout-scroll className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>ФИО</TableHead>
                      <TableHead className="hidden md:table-cell">Телефон</TableHead>
                      <TableHead>Ссылка</TableHead>
                      <TableHead className="w-14"><span className="sr-only">Действия</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((worker) => (
                      <WorkerRow key={worker.id} worker={worker} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </WithAside>
    </>
  );
}

/** Подсказка справа (от 1280 px): как выдать работнику личную ссылку. */
function LinkHint() {
  return (
    <HintCard
      title="Как выдать ссылку"
      illustration="tower"
      items={[
        'В строке работника — «⋯» и «Выдать ссылку».',
        '«Скопировать» и отправьте её лично этому человеку: ссылка — вход без пароля.',
        'Второй раз ссылка не показывается. Потерялась — «Перевыпустить ссылку», старая перестанет работать.',
      ]}
    />
  );
}
