import { isManager, requireWorker } from '@/lib/auth/session';
import { ManagerShell } from '@/components/ManagerShell';
import { PageHeader } from '@/components/PageHeader';
import { WorkerShell } from '@/components/WorkerShell';
import { Illustration } from '@/components/Illustration';

type Zone = { title: string; items: string[] };
type Block = { title: string; items: string[] };

/** Пример памятки для работников: адаптируйте к своей площадке. */
const ZONES: Zone[] = [
  {
    title: 'Вход',
    items: [
      'Приветствовать',
      'Рассказывать о концерте',
      'Проверять билеты',
      'Раздавать программки',
      'Координировать гостей (кафе, туалет, гардероб, которого нет)',
      'Предупреждать смотрителя или админа, если будут буйные и пьяные',
      'Проверять списки приглашённых',
      'Желать хорошего вечера ;)',
    ],
  },
  {
    title: 'Зал',
    items: [
      'Рассказывать гостям о выставке',
      'Помогать гостям найти место',
      'Просить убирать вещи со стульев',
      'Не пускать в зал с напитками',
      'Следить за порядком: пресекать употребление алкоголя, не давать гостям расставлять стулья, просить родителей следить за детьми',
      'Следить, чтоб не заходили на сцену и в закрытые локации',
      'Закрывать/открывать двери',
    ],
  },
  {
    title: 'Балкон',
    items: [
      'Рассказывать гостям о выставке',
      'Помогать гостям найти место',
      'Просить убирать вещи со стульев',
      'Не пускать в зал с напитками',
      'Следить за порядком: пресекать употребление алкоголя, не давать гостям расставлять стулья по собственному желанию, просить родителей следить за детьми',
      'Закрывать/открывать двери',
    ],
  },
];

const KNOW_AND_SKILLS: Block[] = [
  {
    title: 'Знаем',
    items: [
      'Подробности о мероприятии: что сегодня будет, какие инструменты, продолжительность, с антрактом или без',
      'Что сейчас происходит в кирхе (выставка, ремонтные работы и т.д.)',
      'Историю церкви — основные факты (год постройки, что было в советское время, пожар, расписание богослужений)',
    ],
  },
  {
    title: 'Умеем',
    items: [
      'Резать программки',
      'Включать ледбары и световые приборы',
      'Работать с таймпадом/Яндексом (проверка билетов)',
      'Расставлять свечи',
      'Готовить велком-зону',
    ],
  },
];

const IMPORTANT_POINTS: string[] = [
  'Стрессоустойчивость',
  'Не входить в споры с гостями',
  'Работаем на позитиве',
  'Нужно учиться работать с негативом',
  'Быстро реагировать и проявлять инициативу',
  'Быть дипломатичными',
  'Быть информационно стойкими',
  'Не отвлекаться на личные разговоры во время запуска, антракта и во время закрытия',
  'Не употреблять еду и напитки на рабочей позиции',
  'Не уходите с позиции, не предупредив админа',
  'Будьте всегда на связи в рабочем чате',
];

const IMPORTANT_QUOTE =
  'Помните, что выходя работать на концерт — вы становитесь лицом церкви для гостей.';

const CARD = 'rounded-xl border bg-card p-4';
const LIST = 'list-disc space-y-1 pl-5';

function InstructionsContent() {
  return (
    <div className="flex items-start gap-10">
      <div className="flex max-w-2xl min-w-0 flex-col gap-6">
        <p className="rounded-lg bg-status-warning-bg p-3 text-status-warning-fg">
          Доступы к билетным системам и Wi-Fi спрашивайте у администратора смены.
        </p>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Делаем — по зонам</h2>
          {ZONES.map((zone) => (
            <div key={zone.title} data-contain className={CARD}>
              <h3 className="mb-2 font-medium">{zone.title}</h3>
              <ul className={LIST}>
                {zone.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3">
          {KNOW_AND_SKILLS.map((block) => (
            <div key={block.title} data-contain className={CARD}>
              <h3 className="mb-2 font-medium">{block.title}</h3>
              <ul className={LIST}>
                {block.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}

          <div data-contain className={CARD}>
            <h3 className="mb-2 font-medium">Важные моменты</h3>
            <ul className={LIST}>
              {IMPORTANT_POINTS.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <p className="mt-3 italic text-muted-foreground">«{IMPORTANT_QUOTE}»</p>
          </div>
        </section>
      </div>
      <Illustration name="organ" size={200} className="sticky top-8 hidden xl:block" />
    </div>
  );
}

export default async function InstructionsPage() {
  if (await isManager()) {
    return (
      <ManagerShell>
        <PageHeader title="Инструкции" />
        <InstructionsContent />
      </ManagerShell>
    );
  }

  const worker = await requireWorker();

  return (
    <WorkerShell fullName={worker.fullName} title="Памятка">
      <InstructionsContent />
    </WorkerShell>
  );
}
