import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { listEventTypes, getEventTypeSettings, defaultTypeSlots } from '@/lib/eventTypes/operations';
import { PageHeader } from '@/components/PageHeader';
import { HintCard } from '@/components/HintCard';
import { WithAside } from '@/components/WithAside';
import { TypeList } from './TypeList';
export default async function EventTypesPage({searchParams}: {
  searchParams: Promise<{tab?:string|string[]}>;
}) {
  await requireManager();
  const archived = (await searchParams).tab === 'archived';
  const data = await withManager(async tx=>{
    const types = await listEventTypes(tx,{archived});
    const settings = [];
    for (const t of types) settings.push(await getEventTypeSettings(tx,t.id));
    return {types:settings,defaults:await defaultTypeSlots(tx)};
  });
  const hint = (
    <HintCard
      title="Как это работает"
      illustration="calendar"
      items={[
        'У каждого вида — свой состав по должностям.',
        'Ставки вида обновляют ещё не начавшиеся мероприятия; прошлые и уже начавшиеся суммы и отдельные ставки сохраняются.',
        'Новое мероприятие получает состав из шаблона своего вида.',
        'К уже созданным будущим — «Применить к мероприятиям»: людей это не снимает.',
      ]}
    />
  );
  return <>
    <PageHeader title="Виды мероприятий" subtitle="Для каждого вида — свой состав и ставки по должностям. Ставки обновляют ещё не начавшиеся мероприятия. Состав уже созданных будущих меняет кнопка «Применить к мероприятиям»." />
    <WithAside aside={hint}>
      <TypeList {...data} archived={archived} />
    </WithAside>
  </>;
}
