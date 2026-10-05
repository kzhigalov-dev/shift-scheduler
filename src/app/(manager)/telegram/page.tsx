import { withManager } from '@/db/client';
import { requireManager } from '@/lib/auth/session';
import { PageHeader } from '@/components/PageHeader';
import { HintCard } from '@/components/HintCard';
import { WithAside } from '@/components/WithAside';
import { TelegramConnect } from '@/components/TelegramConnect';
import { Card, CardContent } from '@/components/ui/card';
import { telegramApi } from '@/lib/telegram/api';
import { botToken } from '@/lib/telegram/config';
import { getLink } from '@/lib/telegram/links';
import { parseManagerPrefs } from '@/lib/telegram/prefs';
import { connectManagerTelegramAction } from './actions';
import { ManagerNotificationSettings } from './ManagerNotificationSettings';

const WEBHOOK_TIMEOUT_MS = 4000;

/** Состояние вебхука для блока «Бот». Ответ Telegram не должен подвешивать страницу: ждём не дольше 4 секунд. */
async function botStatus(token: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), WEBHOOK_TIMEOUT_MS); });
  const info = await Promise.race([telegramApi(token).getWebhookInfo(), timeout]);
  clearTimeout(timer);
  if (info === null || (!info.ok && info.status === 0)) return 'Не удалось связаться с Telegram.';
  if (!info.ok) return `Ошибка Telegram: ${info.description.replace(/[.\s]+$/u, '')}.`;
  if (!info.result.url) return 'Бот включится в течение минуты после выкладки.';
  const last = info.result.last_error_message?.replace(/[.\s]+$/u, '');
  return last ? `Ошибка Telegram: ${last}.` : 'Бот работает.';
}

export default async function TelegramPage() {
  await requireManager();
  const token = botToken();
  const link = await withManager((tx) => getLink(tx, null));
  const status = token ? await botStatus(token) : null;

  const hint = (
    <HintCard
      title="Как это работает"
      illustration="notes"
      items={[
        'Заявки и отмены приходят сразу — с кнопками «Принять» и «Отпустить».',
        'Нехватка людей на ближайшие дни — каждый день в 12:00.',
        'Что присылать, выбирается здесь после подключения.',
      ]}
    />
  );
  return (
    <>
      <PageHeader title="Уведомления" subtitle="Заявки, отмены и нехватка людей приходят в Telegram." />
      <WithAside width="narrow" aside={hint}>
        <div className="flex flex-col gap-4">
          <Card data-contain>
            <CardContent className="flex flex-col gap-4">
              {link ? (
                <>
                  <div className="flex flex-col gap-1">
                    <p>Telegram подключён.</p>
                    <p className="text-muted-foreground" data-allow-wrap>
                      В боте внизу есть меню: заявки и отмены, нехватка. Если меню не видно — отправьте боту /start.
                    </p>
                  </div>
                  <ManagerNotificationSettings initial={parseManagerPrefs(link.prefs)} />
                </>
              ) : !token ? (
                <p>Telegram пока не настроен.</p>
              ) : (
                <>
                  <p>Уведомления менеджера приходят в Telegram.</p>
                  <TelegramConnect connect={connectManagerTelegramAction} />
                </>
              )}
            </CardContent>
          </Card>
          {status ? (
            <Card data-contain>
              <CardContent className="flex flex-col gap-1">
                <h2 className="font-medium">Бот</h2>
                <p className="text-muted-foreground" data-allow-wrap>{status}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </WithAside>
    </>
  );
}
