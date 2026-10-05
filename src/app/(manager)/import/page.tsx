import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { requireManager } from '@/lib/auth/session';
import { PageHeader } from '@/components/PageHeader';
import { HintCard } from '@/components/HintCard';
import { WithAside } from '@/components/WithAside';
import { ImportForm } from './ImportForm';

export default async function ImportPage() {
  await requireManager();

  const hint = (
    <HintCard
      title="Как это работает"
      illustration="empty"
      items={[
        'Выберите Google-таблицу или файл .xlsx.',
        'Листы без года в названии — укажите год.',
        'Проверьте разбор: до «Импортировать» в базе ничего не меняется.',
      ]}
    />
  );
  return (
    <>
      <PageHeader
        title="Импорт из таблиц"
        subtitle={
          'Работники и смены, расписание или программы концертов. Сначала сверка, затем сохранение выбранных данных.'
        }
      />
      <WithAside aside={hint}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline" className="h-11 lg:h-9"><Link href="/month/new">Расписание мероприятий</Link></Button>
            <Button asChild variant="outline" className="h-11 lg:h-9"><Link href="/import/concerts">Программы концертов</Link></Button>
          </div>
          <section aria-labelledby="staff-import-heading">
            <h2 id="staff-import-heading" className="mb-4 text-lg font-medium">Работники и смены</h2>
            <ImportForm />
          </section>
        </div>
      </WithAside>
    </>
  );
}
