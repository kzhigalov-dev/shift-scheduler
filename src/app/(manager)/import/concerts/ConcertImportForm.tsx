'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { WorkbookInput } from '@/components/WorkbookInput';
import { useRunAction } from '@/components/useRunAction';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/format';
import type { GoogleSourceId } from '@/lib/import/googleSources';
import type { ConcertPreview } from '@/lib/concerts/operations';

type ApiError = { error: string };

export function ConcertImportForm({ month }: { month: string }) {
  const router = useRouter();
  const monthId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<GoogleSourceId | null>(null);
  const [preview, setPreview] = useState<ConcertPreview | null>(null);
  const [keys, setKeys] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [pending, run] = useRunAction();

  async function post<T>(url: string, body: FormData): Promise<T | ApiError> {
    const response = await fetch(url, { method: 'POST', body });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      return { error: 'Сервер не ответил — попробуйте ещё раз.' };
    }
    return await response.json() as T | ApiError;
  }

  function upload(next: File | null, origin: GoogleSourceId | null) {
    setFile(next); setSource(origin); setPreview(null); setKeys(new Set()); setError(null); setUpdated(null);
    if (!next) return;
    run(async () => {
      const body = new FormData();
      body.set('file', next); body.set('month', month);
      if (origin) body.set('source', origin);
      const data = await post<ConcertPreview>('/api/concerts/preview', body);
      if ('error' in data) { setError(data.error); return data; }
      setPreview(data);
      setKeys(new Set(data.rows.filter(row => row.changed && !row.issue).map(row => row.key)));
      return { error: null };
    }, null, undefined, { onError: () => setError(prev => prev ?? 'Не удалось прочитать таблицу — попробуйте ещё раз.') });
  }

  function apply() {
    if (!file || !preview || keys.size === 0 || pending) return;
    setError(null);
    run(async () => {
      const body = new FormData();
      body.set('file', file); body.set('month', month);
      body.set('selection', JSON.stringify({ keys: [...keys], snapshot: preview.snapshot }));
      if (source) body.set('source', source);
      const data = await post<{ updated: number }>('/api/concerts/apply', body);
      if ('error' in data) { setError(data.error); return { error: data.error, updated: 0 }; }
      setUpdated(data.updated); setPreview(null); setKeys(new Set()); router.refresh();
      return { error: null, updated: data.updated };
    }, result => `Обновлено концертов: ${result.updated}`, undefined,
    { onError: () => setError(prev => prev ?? 'Не удалось обновить концерты — попробуйте ещё раз.') });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex max-w-xs flex-col gap-1.5">
        <Label htmlFor={monthId}>Месяц</Label>
        <Input id={monthId} type="month" defaultValue={month} disabled={pending} className="h-11 lg:h-9"
          onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) router.replace(`/import/concerts?month=${e.target.value}`); }} />
      </div>
      <WorkbookInput source="concerts" file={file} onChange={upload} disabled={pending} label="Таблица программ концертов" />
      {pending && <p role="status" className="text-muted-foreground">Читаем и сверяем данные…</p>}
      {error && <p role="alert" className="text-destructive" data-allow-wrap>{error}</p>}
      {updated !== null && (
        <Card data-contain><CardContent className="flex flex-col items-start gap-3">
          <p role="status">Обновлено концертов: {updated}.</p>
          <Button asChild variant="outline" className="h-11 lg:h-9"><Link href={`/month?month=${month}`}>Открыть месяц</Link></Button>
        </CardContent></Card>
      )}
      {preview && (
        <section aria-labelledby="concert-preview-title" className="flex flex-col gap-4">
          <div>
            <h2 id="concert-preview-title" className="text-lg font-medium">Сверка концертов</h2>
            <p className="mt-1 text-sm text-muted-foreground" data-allow-wrap>Ставки, места и назначения людей сохранятся. Пустые ячейки не сотрут уже заполненные данные.</p>
          </div>
          {preview.rows.map(row => (
            <Card key={row.key} data-contain>
              <CardContent className="flex flex-col gap-3" data-allow-wrap>
                <div className="flex flex-wrap items-start gap-3">
                  <Checkbox className="mt-1 shrink-0" checked={keys.has(row.key)} disabled={pending || !!row.issue || !row.changed}
                    aria-label={`Обновить концерт ${row.title ?? row.date}`}
                    onCheckedChange={value => setKeys(prev => {
                      const next = new Set(prev); if (value === true) next.add(row.key); else next.delete(row.key); return next;
                    })} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="font-medium">{row.date ? formatDate(row.date) : 'Дата не определена'}{row.startTime ? ` · ${row.startTime}` : ''}</p>
                    <p className="text-sm text-muted-foreground">{row.sheetName} · строка {row.row}</p>
                    <p className="break-words">{row.before?.title ?? 'Без названия'} → {row.after?.title ?? row.title ?? 'Без названия'}</p>
                  </div>
                  <StatusBadge className="self-start" tone={row.issue ? 'warning' : row.changed ? 'neutral' : 'neutral'}>
                    {row.issue ? 'Не обновляем' : row.changed ? 'Изменения' : 'Без изменений'}
                  </StatusBadge>
                </div>
                {row.issue && <p className="text-sm text-muted-foreground">{row.issue}</p>}
                {(row.after || row.program || row.performers) && (
                  <details className="rounded-md bg-muted/30 p-3">
                    <summary className="cursor-pointer text-sm font-medium">Программа и исполнители</summary>
                    <div className="mt-3 flex flex-col gap-3 text-sm">
                      <div><p className="font-medium">Исполнители</p><p className="mt-1 whitespace-pre-wrap break-words">{row.after?.performers ?? row.performers ?? 'Не указаны'}</p></div>
                      <div><p className="font-medium">Программа</p><p className="mt-1 whitespace-pre-wrap break-words">{row.after?.program ?? row.program ?? 'Не указана'}</p></div>
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" className="h-11 lg:h-9" disabled={pending} onClick={() => upload(null, null)}>Выбрать таблицу заново</Button>
            <Button className="h-11 lg:h-9" disabled={pending || keys.size === 0} onClick={apply}>Обновить выбранные · {keys.size}</Button>
          </div>
        </section>
      )}
    </div>
  );
}
