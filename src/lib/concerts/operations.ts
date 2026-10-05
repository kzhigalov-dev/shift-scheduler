import { createHash } from 'node:crypto';
import type { Tx } from '@/db/client';
import { UserError } from '@/lib/errors';
import type { ConcertRow } from './parseConcerts';

type Details = { title: string | null; program: string | null; performers: string | null };
type Existing = {
  id: string; date: string; startTime: string; concert: string | null;
  program: string | null; performers: string | null; concert_details_imported: boolean;
};
export type ConcertPreviewRow = ConcertRow & {
  eventId: string | null; before: Details | null; after: Details | null; changed: boolean;
};
export type ConcertPreview = { rows: ConcertPreviewRow[]; snapshot: string };

async function existingConcerts(tx: Tx, rows: ConcertRow[], lock: boolean): Promise<Existing[]> {
  const dates = [...new Set(rows.filter(r => !r.issue).map(r => r.date))].sort();
  if (dates.length === 0) return [];
  return tx<Existing[]>`
    select id, to_char(event_date,'YYYY-MM-DD') as date, to_char(start_time,'HH24:MI') as "startTime",
      concert,program,performers,concert_details_imported
    from event where event_date in ${tx(dates)} order by event_date,start_time,id
    ${lock ? tx`for update` : tx``}`;
}

function preview(rows: ConcertRow[], existing: Existing[]): ConcertPreview {
  const matches = new Map(existing.map(e => [`${e.date}|${e.startTime}`,e]));
  const touched = rows.filter(r => !r.issue).map(r => matches.get(`${r.date}|${r.startTime}`) ?? null);
  const snapshot = createHash('sha256').update(JSON.stringify({rows,touched})).digest('hex');
  return { snapshot, rows: rows.map(row => {
    const match = matches.get(`${row.date}|${row.startTime}`);
    const before = match ? {title:match.concert,program:match.program,performers:match.performers} : null;
    const after = before ? {
      title:row.title ?? before.title, program:row.program ?? before.program, performers:row.performers ?? before.performers,
    } : null;
    return { ...row, eventId:match?.id ?? null, before, after,
      issue:row.issue ?? (!match ? 'Нет мероприятия на эту дату и время.' : null),
      changed:before !== null && JSON.stringify(before) !== JSON.stringify(after),
    };
  }) };
}

export async function previewConcerts(tx: Tx, rows: ConcertRow[]): Promise<ConcertPreview> {
  return preview(rows,await existingConcerts(tx,rows,false));
}

/** Только UPDATE известных мероприятий; lock и сверка до первого изменения. */
export async function applyConcerts(tx: Tx, rows: ConcertRow[], keys: string[], snapshot: string): Promise<number> {
  if (keys.length === 0 || new Set(keys).size !== keys.length) throw new UserError('Выберите концерты без повторов.');
  const current = preview(rows,await existingConcerts(tx,rows,true));
  if (snapshot !== current.snapshot) throw new UserError('Данные изменились — обновите сверку и повторите загрузку.');
  const selected = keys.map(key => current.rows.find(row => row.key === key));
  if (selected.some(row => !row || row.issue || !row.eventId || !row.after)) {
    throw new UserError('Выбраны неподходящие строки — обновите сверку.');
  }
  let updated = 0;
  for (const row of selected) {
    if (!row?.changed || !row.after || !row.eventId) continue;
    const changed = await tx<{id:string}[]>`update event set concert=${row.after.title},program=${row.after.program},
      performers=${row.after.performers},concert_details_imported=true where id=${row.eventId} returning id`;
    if (changed.length !== 1) throw new UserError('Мероприятие изменилось — обновите сверку.');
    updated++;
  }
  return updated;
}
