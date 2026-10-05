'use client';

import { useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WorkbookInput } from '@/components/WorkbookInput';
import type { GoogleSourceId } from '@/lib/import/googleSources';
import { StatusBadge } from '@/components/StatusBadge';
import { useRunAction } from '@/components/useRunAction';
import type { EventTag } from '@/lib/import/parseSheet';
import { formatDate, pluralRu } from '@/lib/format';
import { monthTitle } from '@/lib/month';
import type { ScheduleEvent } from '@/lib/schedule/parseSchedule';
import type { ScheduleDiff } from '@/lib/schedule/diff';
import { createEmptyMonthAction } from './actions';

type PreviewSheet = { name: string; month: string; events: ScheduleEvent[]; diff?: ScheduleDiff };
type Preview = { mode: 'create' | 'update'; sheets: PreviewSheet[]; dbSnapshot: string | null };
type ApiError = { error: string };

const NO_ANSWER = 'Сервер не ответил — попробуйте ещё раз';

const eventsWord = (n: number) => pluralRu(n, ['мероприятие', 'мероприятия', 'мероприятий']);
const peopleWord = (n: number) => pluralRu(n, ['человек', 'человека', 'человек']);
const when = (e: { date: string; startTime: string }) =>
  `${formatDate(e.date, { weekday: 'short' })}, ${e.startTime}`;

function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function NewMonthFlow({ month, status, events, typeNames }: {
  month: string; status: 'draft' | 'published' | null; events: number; typeNames: Record<EventTag,string>;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<GoogleSourceId | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sheetName, setSheetName] = useState('');
  /** Последняя ошибка загрузки или применения — видна и после того, как тост исчез. */
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [creatingEmpty, runEmpty] = useRunAction();
  const monthId = useId();
  const fileId = useId();
  const isNew = events === 0;
  const sheet = preview?.sheets.find((s) => s.name === sheetName) ?? null;

  async function post<T>(url: string, fields: Record<string, string | File>): Promise<T | ApiError> {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    const res = await fetch(url, { method: 'POST', body });
    // Платформа может ответить своей HTML-страницей (413, 500) — это не ответ маршрута.
    if (!res.headers.get('content-type')?.includes('application/json')) return { error: NO_ANSWER };
    try {
      return (await res.json()) as T | ApiError;
    } catch {
      return { error: NO_ANSWER };
    }
  }

  function fail(message: string) {
    setError(message);
    toast.error(message);
  }

  /** null — файл убран: сбрасываются разбор, выбранный лист и ошибка. */
  function upload(next: File | null, origin: GoogleSourceId | null = null) {
    setSource(origin);
    setFile(next);
    setPreview(null);
    setSheetName('');
    setError(null);
    if (!next) return;
    startLoading(async () => {
      try {
        const data = await post<Preview>('/api/schedule/preview', { file: next, month, ...(origin ? { source: origin } : {}) });
        if ('error' in data) { fail(data.error); return; }
        setPreview(data);
        setSheetName(data.sheets[0]?.name ?? '');
      } catch {
        fail('Не удалось отправить файл — проверьте соединение');
      }
    });
  }

  function apply(selection: object) {
    if (!file || !sheet) return;
    setError(null);
    startLoading(async () => {
      try {
        const data = await post<{ ok: true }>('/api/schedule/apply', {
          file, month, sheet: sheet.name, selection: JSON.stringify(selection),
          ...(source ? { source, snapshot: preview?.dbSnapshot ?? '' } : {}),
        });
        if ('error' in data) { fail(data.error); return; }
        toast.success(isNew ? 'Черновик месяца создан' : 'Расписание обновлено');
        router.push(`/month/${month}/plan`);
      } catch {
        fail('Не удалось отправить файл — проверьте соединение');
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-xs flex-col gap-1.5">
        <Label htmlFor={monthId}>Месяц</Label>
        <Input
          id={monthId} type="month" defaultValue={month} className="h-11 lg:h-9"
          onChange={(e) => {
            if (/^\d{4}-\d{2}$/.test(e.target.value)) router.replace(`/month/new?month=${e.target.value}`);
          }}
        />
      </div>

      {!isNew && (
        <Card>
          <CardHeader>
            <CardTitle>{monthTitle(month)} уже есть</CardTitle>
            <CardDescription>
              В месяце {events} {eventsWord(events)}{status === 'draft' ? ', это черновик' : ''}.
              Загрузите расписание снова — покажем, что изменилось.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="h-11 lg:h-9">
              <Link href={`/month/${month}/plan`}><LayoutGrid aria-hidden="true" />Открыть таблицу</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-4" aria-hidden="true" />
              {isNew ? 'Из расписания' : 'Загрузить расписание снова'}
            </CardTitle>
            <CardDescription>Файл «Расписание мероприятий», лист месяца {monthTitle(month).toLowerCase()}.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <WorkbookInput source="schedule" id={fileId} label="Файл .xlsx" file={file} onChange={upload} disabled={loading} />
            {preview && preview.sheets.length > 1 && (
              <Select value={sheetName} onValueChange={setSheetName}>
                <SelectTrigger className="h-11 w-full lg:h-9" aria-label="Лист"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {preview.sheets.map((s) => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        {isNew && (
          <Card>
            <CardHeader>
              <CardTitle>Пустой месяц</CardTitle>
              <CardDescription>Мероприятия добавите столбцами прямо в таблице.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline" className="h-11 lg:h-9" disabled={creatingEmpty}
                onClick={() => runEmpty(() => createEmptyMonthAction(month), 'Черновик месяца создан')}
              >
                Создать пустой
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {sheet && preview?.mode === 'create' && (
        <RowsStep key={sheet.name} events={sheet.events} typeNames={typeNames} pending={loading} onSubmit={(keys) => apply({ keys })} />
      )}
      {sheet?.diff && preview?.mode === 'update' && (
        <DiffStep key={sheet.name} diff={sheet.diff} explicitChanges={!!source} pending={loading} onSubmit={apply} />
      )}
    </div>
  );
}

function RowsStep({ events, typeNames, pending, onSubmit }: {
  events: ScheduleEvent[]; typeNames: Record<EventTag,string>; pending: boolean; onSubmit: (keys: string[]) => void;
}) {
  const [checked, setChecked] = useState(() => new Set(events.filter((e) => e.checked).map((e) => e.key)));
  // Строки без замечаний есть, но ни одна не отмечена (например, только приход). Если замечания у всех —
  // пояснять нечего: причины и так видны у строк.
  const takeable = events.filter((e) => e.issue === null);
  const noneByDefault = takeable.length > 0 && !takeable.some((e) => e.checked);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Мероприятия</CardTitle>
        {!noneByDefault && (
          <CardDescription>Отмечены концерты, ужины и экскурсии Арт-Зерна. Галочки можно поменять.</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {noneByDefault && (
          <p className="text-sm text-muted-foreground">
            Отмечать по умолчанию нечего: на листе нет концертов, ужинов и экскурсий Арт-Зерна.
            Галочки можно поставить вручную.
          </p>
        )}
        <div data-layout-scroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><span className="sr-only">Взять</span></TableHead>
                <TableHead>Когда</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Организатор</TableHead>
                <TableHead>Направление</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.key}>
                  <TableCell>
                    <Checkbox
                      checked={checked.has(e.key)} disabled={e.issue !== null}
                      onCheckedChange={() => setChecked((s) => toggled(s, e.key))}
                      aria-label={`Взять «${e.title || 'без названия'}»`}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {e.date ? formatDate(e.date, { weekday: 'short' }) : '—'}{e.startTime ? `, ${e.startTime}` : ''}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{typeNames[e.tag]}</TableCell>
                  <TableCell className="min-w-64">
                    <p>{e.title || 'Без названия'}</p>
                    {e.issue && (
                      <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <StatusBadge tone="warning">Проблема</StatusBadge>{e.issue}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{e.organizer}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{e.direction}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex justify-end">
          <Button className="h-11 lg:h-9" disabled={pending || checked.size === 0} onClick={() => onSubmit([...checked])}>
            Создать черновик · {checked.size}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DiffStep({ diff, pending, onSubmit, explicitChanges = false }: {
  diff: ScheduleDiff; pending: boolean; explicitChanges?: boolean;
  onSubmit: (selection: { add: string[]; change: string[]; remove: string[] }) => void;
}) {
  const [add, setAdd] = useState(() => new Set(diff.added.filter((e) => e.checked && e.issue===null).map((e) => e.key)));
  const [change, setChange] = useState(() => new Set(explicitChanges ? [] : diff.changed.map((c) => c.eventId)));
  const [remove, setRemove] = useState(() => new Set<string>());
  const empty = diff.added.length + diff.changed.length + diff.missing.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Что изменилось</CardTitle>
        <CardDescription>Без изменений: {diff.unchanged}. {explicitChanges && 'Переносы времени и удаления отмечайте вручную.'}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {empty && <p className="text-muted-foreground">Расписание не изменилось.</p>}
        {diff.added.length > 0 && (
          <DiffSection title={`Новые · ${diff.added.length}`}>
            {diff.added.map((e) => (
              <DiffRow key={e.key} checked={add.has(e.key)} onChange={() => setAdd((s) => toggled(s, e.key))}
                label={`${when(e)} · ${e.title || 'Без названия'}`}
                disabled={e.issue !== null} note={e.issue ?? [e.organizer, e.direction].filter(Boolean).join(', ')} />
            ))}
          </DiffSection>
        )}
        {diff.changed.length > 0 && (
          <DiffSection title={`Изменились · ${diff.changed.length}`}>
            {diff.changed.map((c) => (
              <DiffRow key={c.eventId} checked={change.has(c.eventId)} onChange={() => setChange((s) => toggled(s, c.eventId))}
                label={`${formatDate(c.after.date, { weekday: 'short' })}: ${c.before.startTime} «${c.before.title}» → ${c.after.startTime} «${c.after.title}»`} />
            ))}
          </DiffSection>
        )}
        {diff.missing.length > 0 && (
          <DiffSection title={`Нет в расписании · ${diff.missing.length}`}>
            {diff.missing.map((m) => (
              <DiffRow key={m.eventId} checked={remove.has(m.eventId)} onChange={() => setRemove((s) => toggled(s, m.eventId))}
                label={`Удалить: ${when(m)} · ${m.title}`}
                badge={m.people > 0 ? <StatusBadge tone="danger">{m.people} {peopleWord(m.people)}</StatusBadge> : null} />
            ))}
          </DiffSection>
        )}
        <div className="flex justify-end">
          <Button className="h-11 lg:h-9" disabled={pending || empty}
            onClick={() => onSubmit({ add: [...add], change: [...change], remove: [...remove] })}>
            Применить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DiffSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}

/** `note` — пояснение серым после подписи (у новых: организатор и направление — почему без галочки). */
function DiffRow({ checked, onChange, label, note, badge, disabled }: {
  checked: boolean; disabled?: boolean; onChange: () => void; label: string; note?: string; badge?: React.ReactNode;
}) {
  const id = useId();
  return (
    <li className="flex min-h-11 items-center gap-3 lg:min-h-9">
      <Checkbox id={id} disabled={disabled} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="min-w-0 flex-1 break-words" data-allow-wrap>
        {label}
        {note && <span className="text-muted-foreground"> · {note}</span>}
      </label>
      {badge}
    </li>
  );
}
