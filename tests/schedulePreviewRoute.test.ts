import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserError } from '@/lib/errors';
import type { ScheduleSheet } from '@/lib/schedule/parseSchedule';

vi.mock('@/lib/auth/session', () => ({ isManager: async () => true }));
const readWorkbook = vi.fn();
vi.mock('@/lib/import/workbook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/import/workbook')>()),
  readWorkbook: (buffer: Buffer) => readWorkbook(buffer),
}));

// Месяц без мероприятий в базе: маршрут идёт по ветке «создать», база не нужна.
vi.mock('@/db/client', () => ({ withManager: <T>(fn: (tx: never) => Promise<T>) => fn({} as never) }));
vi.mock('@/lib/monthPlan/months', () => ({
  monthInfo: async () => ({ status: null, events: 0 }),
  existingForDiff: async () => [],
}));

const typeIssues = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/eventTypes/importChecks',()=>({scheduleTypeIssues:(...args:Parameters<typeof import('@/lib/eventTypes/importChecks').scheduleTypeIssues>)=>typeIssues(...args)}));

const { POST } = await import('@/app/api/schedule/preview/route');

function upload(): Request {
  const body = new FormData();
  body.set('month', '2099-07');
  body.set('file', new File([new Uint8Array([1, 2, 3])], 'schedule.xlsx'));
  // Как из браузера: Origin — страница самого приложения (L1).
  return new Request('http://localhost/api/schedule/preview', { method: 'POST', body, headers: { origin: 'http://localhost' } });
}

describe('POST /api/schedule/preview — файл не разобрался', () => {
  let logged: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    readWorkbook.mockReset();
    logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => logged.mockRestore());

  it('UserError — её текст', async () => {
    readWorkbook.mockRejectedValue(new UserError('В файле нет листов'));
    const res = await POST(upload());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'В файле нет листов' });
  });

  it('таблица с работниками вместо расписания — подсказка про «Импорт»', async () => {
    readWorkbook.mockResolvedValue([{ name: 'Июль 2099', rows: [
      ['Даты', '9.7'], ['День недели', 'четверг'], ['Время начала', '20:00'], ['Админ', 'Ян Образцовый'], ['Оплата', 1300],
    ] }]);
    const res = await POST(upload());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Это таблица с работниками, а не расписание мероприятий. Её загружают в «Импорт».' });
  });

  it('прочая ошибка — общий текст, сама ошибка — в лог', async () => {
    const error = new Error('zip: bad header');
    readWorkbook.mockRejectedValue(error);
    const res = await POST(upload());
    expect(await res.json()).toEqual({ error: 'Не удалось прочитать файл — это точно .xlsx?' });
    expect(logged).toHaveBeenCalledWith(error);
  });
});

const HEADER = ['дата', 'направление', 'площадка', 'организатор', 'название', 'начало'];
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const t = (hh: number, mm: number) => new Date(Date.UTC(1899, 11, 30, hh, mm));
/** Лист расписания июля 2099: `concerts` — время концертов Анненкирхе, остальные дни пустые. */
function julySheet(name: string, ...concerts: number[]) {
  const rows = [
    HEADER,
    [d('2099-07-01'), '', '', '', '', null],
    [d('2099-07-02'), 'концерт', 'ПУШКИН', 'арт-зерно', 'Другая площадка', t(18, 0)],
    ...concerts.map((hh) => [d('2099-07-03'), 'концерт', 'АННЕНКИРХЕ', 'арт-зерно', `Концерт ${hh}`, t(hh, 0)]),
  ];
  return { name, rows };
}

describe('POST /api/schedule/preview — лист месяца без мероприятий', () => {
  beforeEach(() => readWorkbook.mockReset());

  it('лист есть, но мероприятий Анненкирхе в нём нет — понятный текст', async () => {
    readWorkbook.mockResolvedValue([julySheet('июль 99'), julySheet('июль 99 (2)')]);
    const res = await POST(upload());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Лист «июль 99» есть, но мероприятий Анненкирхе в нём пока нет. '
        + 'Заполните расписание или создайте пустой месяц.',
    });
  });

  it('листа за месяц нет — прежний текст', async () => {
    readWorkbook.mockResolvedValue([{ name: 'рао', rows: [['дата', 'организатор']] }]);
    const res = await POST(upload());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'В файле нет листа расписания за июль 2099' });
  });

  it('пустые листы не попадают в выбор, если есть лист с мероприятиями', async () => {
    readWorkbook.mockResolvedValue([julySheet('пустой'), julySheet('июль 99', 20), julySheet('ещё пустой')]);
    const res = await POST(upload());
    expect(res.status).toBe(200);
    const data = await res.json() as { mode: string; sheets: ScheduleSheet[] };
    expect(data.mode).toBe('create');
    expect(data.sheets.map((s) => [s.name, s.events.length])).toEqual([['июль 99', 1]]);
  });
});

it('архивный вид показывает проблему и снимает галочку нового мероприятия', async()=>{
  typeIssues.mockResolvedValueOnce([{date:'2099-07-03',startTime:'20:00',message:'Вид в архиве'}]);
  readWorkbook.mockResolvedValue([julySheet('июль 99',20)]);
  const res=await POST(upload());
  const data=await res.json() as {sheets:ScheduleSheet[]};
  expect(data.sheets[0].events[0]).toMatchObject({issue:'Вид в архиве',checked:false});
});
