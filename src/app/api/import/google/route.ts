import { isManager } from '@/lib/auth/session';
import { crossSiteResponse, isSameOrigin } from '@/lib/http/sameOrigin';
import { userMessage } from '@/lib/errors';
import { googleSource, type GoogleSourceId } from '@/lib/import/googleSources';
import { downloadGoogleWorkbook, workbookDigest } from '@/lib/import/googleDownload';
import { readWorkbook } from '@/lib/import/workbook';

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isManager())) return Response.json({ error: 'Нужен вход менеджера' }, { status: 401 });
  if (!isSameOrigin(request)) return crossSiteResponse();
  try {
    const form = await request.formData();
    const source = String(form.get('source') ?? '');
    googleSource(source);
    const buffer = await downloadGoogleWorkbook(source as GoogleSourceId);
    const digest = workbookDigest(await readWorkbook(buffer));
    return new Response(new Uint8Array(buffer), { headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'cache-control': 'no-store', 'x-workbook-digest': digest,
    } });
  } catch (error) {
    return Response.json({ error: userMessage(error) }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}
