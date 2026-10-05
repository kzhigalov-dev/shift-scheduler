import { isManager } from '@/lib/auth/session';
import { crossSiteResponse, isSameOrigin } from '@/lib/http/sameOrigin';
import { withManager } from '@/db/client';
import { userMessage, UserError } from '@/lib/errors';
import { isMonth } from '@/lib/month';
import { readInputWorkbook } from '@/lib/import/inputWorkbook';
import { parseConcerts } from '@/lib/concerts/parseConcerts';
import { previewConcerts } from '@/lib/concerts/operations';

export async function POST(request: Request) {
  if (!(await isManager())) return Response.json({ error: 'Нужен вход менеджера' }, { status: 401 });
  if (!isSameOrigin(request)) return crossSiteResponse();
  try {
    const form = await request.formData();
    const month = String(form.get('month') ?? '');
    if (!isMonth(month)) throw new UserError('Неверный месяц');
    const { sheets } = await readInputWorkbook(form,'concerts');
    const rows = parseConcerts(sheets,month);
    if (rows.length === 0) throw new UserError('В таблице нет программ концертов за выбранный месяц.');
    return Response.json(await withManager(tx => previewConcerts(tx,rows)),{headers:{'cache-control':'no-store'}});
  } catch (error) {
    return Response.json({error:userMessage(error)},{status:400});
  }
}
