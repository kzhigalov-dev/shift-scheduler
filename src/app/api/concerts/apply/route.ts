import { isManager } from '@/lib/auth/session';
import { crossSiteResponse, isSameOrigin } from '@/lib/http/sameOrigin';
import { withManager } from '@/db/client';
import { userMessage, UserError } from '@/lib/errors';
import { isMonth } from '@/lib/month';
import { readInputWorkbook } from '@/lib/import/inputWorkbook';
import { parseConcertSelection } from '@/lib/import/prepare';
import { parseConcerts } from '@/lib/concerts/parseConcerts';
import { applyConcerts } from '@/lib/concerts/operations';

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isManager())) return Response.json({ error: 'Нужен вход менеджера' }, { status: 401 });
  if (!isSameOrigin(request)) return crossSiteResponse();
  try {
    const form = await request.formData();
    const month = String(form.get('month') ?? '');
    if (!isMonth(month)) throw new UserError('Неверный месяц');
    const selection = parseConcertSelection(JSON.parse(String(form.get('selection') ?? '{}')));
    const { sheets } = await readInputWorkbook(form,'concerts',true);
    const rows = parseConcerts(sheets,month);
    const updated = await withManager(tx => applyConcerts(tx,rows,selection.keys,selection.snapshot));
    return Response.json({updated},{headers:{'cache-control':'no-store'}});
  } catch (error) {
    return Response.json({error:userMessage(error)},{status:400});
  }
}
