import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { revalidatePath } from 'next/cache';
import { webhookSecret } from '@/lib/telegram/config';
import { encodeCallback } from '@/lib/telegram/callbacks';

// Без базы и без Telegram: соединение, привязки, api и тик подменены.
vi.mock('@/db/client', () => ({
  withAnon: <T>(fn: (tx: never) => Promise<T>) => fn({} as never),
  withManager: <T>(fn: (tx: never) => Promise<T>) => fn({} as never),
  withWorker: <T>(workerId: string, fn: (tx: never) => Promise<T>) => { withWorkerAs(workerId); return fn({} as never); },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const withWorkerAs = vi.fn();
const createSignup = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock('@/app/(worker)/queries', () => ({
  createSignup: (...args: unknown[]) => createSignup(...args),
  withdrawSignup: vi.fn(),
  requestCancel: vi.fn(),
}));
const linkTelegram = vi.fn();
const telegramOwner = vi.fn();
vi.mock('@/lib/telegram/links', () => ({
  linkTelegram: (...args: unknown[]) => linkTelegram(...args),
  telegramOwner: (...args: unknown[]) => telegramOwner(...args),
}));
const sendMessage = vi.fn(async () => ({ ok: true, result: {} }));
const answerCallbackQuery = vi.fn(async () => ({ ok: true, result: true }));
const editMessageText = vi.fn(async () => ({ ok: true, result: true }));
const telegramApi = vi.fn((token: string) => ({ token, sendMessage, answerCallbackQuery, editMessageText }));
vi.mock('@/lib/telegram/api', () => ({ telegramApi: (token: string) => telegramApi(token) }));
const isTickRequest = vi.fn();
vi.mock('@/lib/telegram/requests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telegram/requests')>()),
  isTickRequest: (request: Request) => isTickRequest(request),
}));
const runTick = vi.fn();
vi.mock('@/lib/telegram/tick', () => ({ runTick: (...args: unknown[]) => runTick(...args) }));

const webhook = await import('@/app/api/telegram/webhook/route');
const tick = await import('@/app/api/telegram/tick/route');

const TOKEN = 'TEST';
const update = (text: string, chatId = 42, type = 'private') => ({ update_id: 1, message: { message_id: 1, chat: { id: chatId, type }, text } });
function hook(body: unknown, secret?: string): Request {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
    body: JSON.stringify(body),
  });
}

describe('POST /api/telegram/webhook', () => {
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    linkTelegram.mockReset();
    telegramOwner.mockReset();
    sendMessage.mockClear();
    answerCallbackQuery.mockClear();
    editMessageText.mockClear();
    withWorkerAs.mockClear();
    createSignup.mockClear();
    vi.mocked(revalidatePath).mockClear();
    telegramApi.mockClear();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved;
  });

  it('без заголовка и с неверным секретом — 401, ничего не делает', async () => {
    expect((await webhook.POST(hook(update('/start abc')))).status).toBe(401);
    expect((await webhook.POST(hook(update('/start abc'), 'wrong'))).status).toBe(401);
    expect((await webhook.POST(hook(update('/start abc'), webhookSecret('OTHER')))).status).toBe(401);
    expect(linkTelegram).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('без ключа бота — 401 даже с любым секретом', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect((await webhook.POST(hook(update('/start abc'), webhookSecret(TOKEN)))).status).toBe(401);
  });

  it('/start <код> с верным секретом — привязка и «Готово!»', async () => {
    linkTelegram.mockResolvedValue('worker');
    const res = await webhook.POST(hook(update('/start abc', 77), webhookSecret(TOKEN)));
    expect(res.status).toBe(200);
    expect(linkTelegram).toHaveBeenCalledWith(expect.anything(), 'abc', 77);
    expect(telegramApi).toHaveBeenCalledWith(TOKEN);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, markup] = sendMessage.mock.calls[0] as unknown as [number, string, { keyboard: Array<Array<{ text: string }>> }];
    expect(chatId).toBe(77);
    expect(text).toContain('<b>Готово!</b>');
    expect(text).toContain('Внизу чата — меню: смены, свободные места, заработок.');
    expect(markup.keyboard[0][0]).toEqual({ text: '📅 Мои смены' });
  });

  it('/start <код> менеджера — меню менеджера', async () => {
    linkTelegram.mockResolvedValue('manager');
    await webhook.POST(hook(update('/start abc', 78), webhookSecret(TOKEN)));
    const [, text, markup] = sendMessage.mock.calls[0] as unknown as [number, string, { keyboard: Array<Array<{ text: string }>> }];
    expect(text).toContain('Внизу чата — меню: заявки и отмены, нехватка.');
    expect(markup.keyboard[0][0]).toEqual({ text: '📥 Заявки и отмены' });
  });

  it('устаревший код — подсказка обновить ссылку', async () => {
    linkTelegram.mockResolvedValue('invalid');
    await webhook.POST(hook(update('/start abc'), webhookSecret(TOKEN)));
    const [, text, markup] = sendMessage.mock.calls[0] as unknown as [number, string, unknown];
    expect(text).toContain('устарела');
    expect(markup).toBeUndefined();
  });

  it('/start без кода — подсказка, привязка не вызывается', async () => {
    telegramOwner.mockResolvedValue(null);
    await webhook.POST(hook(update('/start'), webhookSecret(TOKEN)));
    expect(linkTelegram).not.toHaveBeenCalled();
    const [, text, markup] = sendMessage.mock.calls[0] as unknown as [number, string, unknown];
    expect(text).toContain('Подключитесь из приложения');
    expect(markup).toEqual({ remove_keyboard: true });
  });

  it('/start без кода из уже подключённого чата — «уже подключено», не «Подключитесь»', async () => {
    telegramOwner.mockResolvedValue({ workerId: 'w', isManager: false });
    await webhook.POST(hook(update('/start', 8), webhookSecret(TOKEN)));
    expect(linkTelegram).not.toHaveBeenCalled();
    expect(telegramOwner).toHaveBeenCalledWith(expect.anything(), 8);
    const [chatId, text, markup] = sendMessage.mock.calls[0] as unknown as [number, string, { keyboard: Array<Array<{ text: string }>> }];
    expect(chatId).toBe(8);
    expect(text).toContain('уже подключены');
    expect(text).not.toContain('Подключитесь из приложения');
    expect(markup.keyboard[0][0]).toEqual({ text: '📅 Мои смены' });
  });

  it('группа: ни /start, ни текст не проверяются, ответа нет', async () => {
    for (const type of ['group', 'supergroup', 'channel']) {
      const res = await webhook.POST(hook(update('/start@DemoShiftsBot abc', -500, type), webhookSecret(TOKEN)));
      expect(res.status).toBe(200);
    }
    expect((await webhook.POST(hook(update('/start', -500, 'group'), webhookSecret(TOKEN)))).status).toBe(200);
    expect((await webhook.POST(hook(update('привет', -500, 'group'), webhookSecret(TOKEN)))).status).toBe(200);
    expect(linkTelegram).not.toHaveBeenCalled();
    expect(telegramOwner).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('текст от неподключённого чата — подсказка', async () => {
    telegramOwner.mockResolvedValue(null);
    const res = await webhook.POST(hook(update('привет', 5), webhookSecret(TOKEN)));
    expect(res.status).toBe(200);
    expect(telegramOwner).toHaveBeenCalledWith(expect.anything(), 5);
    const [chatId, text] = sendMessage.mock.calls[0] as unknown as [number, string];
    expect(chatId).toBe(5);
    expect(text).toContain('Подключитесь из приложения');
  });

  it('текст от подключённого чата — список команд', async () => {
    telegramOwner.mockResolvedValue({ workerId: 'w', isManager: false });
    expect((await webhook.POST(hook(update('привет'), webhookSecret(TOKEN)))).status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = sendMessage.mock.calls[0] as unknown as [number, string];
    expect(chatId).toBe(42);
    expect(text).toContain('/shifts — мои смены');
  });

  const EVENT = '0b0e1c7e-3d8a-4a5e-9f3b-2f6f5e0a7c11';
  const press = (data: string, chatId = 42) => ({
    update_id: 3,
    callback_query: {
      id: 'cb9', data, from: { id: chatId },
      message: {
        message_id: 5, chat: { id: chatId, type: 'private' }, text: 'Нужен человек',
        reply_markup: { inline_keyboard: [[{ text: 'Записаться', callback_data: data }]] },
      },
    },
  });

  it('нажатие кнопки работника: от имени владельца чата, ответ, правка, revalidate', async () => {
    telegramOwner.mockResolvedValue({ workerId: 'w-42', isManager: false });
    const res = await webhook.POST(hook(press(encodeCallback({ op: 'su', eventId: EVENT })), webhookSecret(TOKEN)));
    expect(res.status).toBe(200);
    expect(withWorkerAs).toHaveBeenCalledWith('w-42');
    expect(createSignup).toHaveBeenCalledWith(expect.anything(), { workerId: 'w-42', eventId: EVENT });
    expect(answerCallbackQuery).toHaveBeenCalledWith('cb9', 'Заявка подана', undefined);
    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path))
      .toEqual(['/shifts', '/available', '/month', `/event/${EVENT}`]);
  });

  it('нажатие без секрета — 401, ничего не происходит', async () => {
    expect((await webhook.POST(hook(press(encodeCallback({ op: 'su', eventId: EVENT }))))).status).toBe(401);
    expect(telegramOwner).not.toHaveBeenCalled();
    expect(answerCallbackQuery).not.toHaveBeenCalled();
  });

  it('нажатие не в личном чате — «Кнопка устарела», владелец не проверяется', async () => {
    const body = press(encodeCallback({ op: 'su', eventId: EVENT }));
    body.callback_query.message.chat.type = 'supergroup';
    expect((await webhook.POST(hook(body, webhookSecret(TOKEN)))).status).toBe(200);
    expect(telegramOwner).not.toHaveBeenCalled();
    expect(createSignup).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith('cb9', 'Кнопка устарела');
  });

  it('мусор в теле — 200 без действий', async () => {
    const res = await webhook.POST(hook('мусор', webhookSecret(TOKEN)));
    expect(res.status).toBe(200);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('POST /api/telegram/tick', () => {
  beforeEach(() => {
    isTickRequest.mockReset();
    runTick.mockReset();
    telegramApi.mockClear();
  });

  it('без секрета тика — 401, тик не запускается', async () => {
    isTickRequest.mockResolvedValue(false);
    const res = await tick.POST(new Request('http://localhost/api/telegram/tick', { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
  });

  it('с верным секретом — 200 и итог тика', async () => {
    isTickRequest.mockResolvedValue(true);
    runTick.mockResolvedValue({ processed: 1, sent: 2, failed: 0 });
    const res = await tick.POST(new Request('http://localhost/api/telegram/tick', {
      method: 'POST', headers: { host: 'app.example.com', 'x-forwarded-proto': 'https' },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 1, sent: 2, failed: 0 });
    expect(runTick).toHaveBeenCalledTimes(1);
    const opts = (runTick.mock.calls[0] as unknown[])[0] as { origin: string; api: unknown; secret: string | null; db: unknown };
    expect(opts.origin).toBe('https://app.example.com');
    expect(typeof opts.db).toBe('function');
  });
});
