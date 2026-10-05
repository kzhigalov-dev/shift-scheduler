import { withWorker } from '@/db/client';
import { requireWorker } from '@/lib/auth/session';
import { WorkerShell } from '@/components/WorkerShell';
import { TelegramConnect } from '@/components/TelegramConnect';
import { Card, CardContent } from '@/components/ui/card';
import { Illustration } from '@/components/Illustration';
import { isTelegramConfigured } from '@/lib/telegram/config';
import { getLink } from '@/lib/telegram/links';
import { parseWorkerPrefs } from '@/lib/telegram/prefs';
import { connectTelegramAction } from './actions';
import { NotificationSettings } from './NotificationSettings';

export default async function NotificationsPage() {
  const worker = await requireWorker();
  const configured = isTelegramConfigured();
  const link = await withWorker(worker.id, (tx) => getLink(tx, worker.id));

  return (
    <WorkerShell fullName={worker.fullName} title="Уведомления">
      <div className="flex items-start gap-10">
        <Card data-contain className="w-full max-w-xl">
          <CardContent className="flex flex-col gap-4">
            {link ? (
              <>
                <div className="flex flex-col gap-1">
                  <p>Telegram подключён.</p>
                  <p className="text-muted-foreground" data-allow-wrap>
                    В боте внизу есть меню: смены, свободные места, заработок. Если меню не видно — отправьте боту /start.
                  </p>
                </div>
                <NotificationSettings initial={parseWorkerPrefs(link.prefs)} />
              </>
            ) : !configured ? (
              <p>Telegram пока не настроен.</p>
            ) : (
              <>
                <p>Уведомления о сменах приходят в Telegram.</p>
                <TelegramConnect connect={connectTelegramAction} />
              </>
            )}
          </CardContent>
        </Card>
        <Illustration name="notes" size={200} className="mt-2 hidden xl:block" />
      </div>
    </WorkerShell>
  );
}
