import { requireManager } from '@/lib/auth/session';
import { monthParam } from '@/lib/month';
import { PageHeader } from '@/components/PageHeader';
import { ConcertImportForm } from './ConcertImportForm';

export default async function ConcertImportPage({ searchParams }: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  await requireManager();
  const month = monthParam((await searchParams).month);
  return (
    <>
      <PageHeader title="Программы концертов" breadcrumbs={[{ href: '/import', label: 'Импорт' }]}
        subtitle="Название, исполнители и программа из «Орган и не только». Обновляем только мероприятия, которые уже есть в календаре." />
      <ConcertImportForm key={month} month={month} />
    </>
  );
}
