import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Страница входа целиком (серверный компонент → HTML): роли — подменой session.ts, redirect — исключение.
const auth = vi.hoisted(() => ({
  manager: false,
  worker: null as { id: string; fullName: string } | null,
}));
vi.mock('@/lib/auth/session', () => ({
  isManager: async () => auth.manager,
  getCurrentWorker: async () => auth.worker,
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
vi.mock('@/app/login/actions', () => ({ loginManager: vi.fn() }));

const { default: LoginPage } = await import('@/app/login/page');

async function render(params: Record<string, string>): Promise<string> {
  const page = await LoginPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(page)
    .replace(/<!-- -->/g, '')
    .replace(/&quot;/g, '"');
}
/** Видимый текст без тегов: проверка копий целиком, как их видит человек. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const WORKER_TEXT = 'Откройте свою личную ссылку от менеджера или нажмите «Открыть приложение» в Telegram-боте @DemoShiftsBot.';

beforeEach(() => {
  auth.manager = false;
  auth.worker = null;
});

describe('/login?for=worker без входа', () => {
  it('сверху — «Это кабинет работника» и ссылка на бота; форма менеджера свёрнута под «Я менеджер»', async () => {
    const html = await render({ for: 'worker' });
    expect(text(html)).toContain('Это кабинет работника');
    expect(text(html)).toContain(WORKER_TEXT);
    expect(html).toMatch(/<a [^>]*href="https:\/\/t\.me\/DemoShiftsBot"[^>]*>(?:(?!<\/a>)[\s\S])*Открыть бота<\/a>/);
    expect(html.indexOf('Это кабинет работника')).toBeLessThan(html.indexOf('Я менеджер'));
    // Свёрнуто: <details> без open, поле пароля — внутри.
    const details = /<details(?![^>]*\bopen\b)[^>]*>([\s\S]*?)<\/details>/.exec(html);
    expect(details?.[1]).toMatch(/<summary[^>]*>[\s\S]*Я менеджер[\s\S]*<\/summary>/);
    expect(details?.[1]).toContain('type="password"');
    expect(html.match(/type="password"/g)).toHaveLength(1);
    // Свёрнутое поле не забирает фокус.
    expect(html).not.toMatch(/autofocus/i);
    expect(text(html)).not.toContain('Вход для менеджера');
  });

  it('error=tg — «Ссылка для входа устарела…» и тот же экран работника', async () => {
    const html = await render({ error: 'tg' });
    expect(text(html)).toContain('Ссылка для входа устарела — нажмите «Открыть приложение» в боте ещё раз.');
    expect(text(html)).toContain('Это кабинет работника');
    expect(html).toContain('<details');
  });

  it('error=tg-used — ссылка уже использована (повтор после входа, L4), а не «устарела»', async () => {
    const html = await render({ error: 'tg-used' });
    expect(text(html)).toContain('Эта ссылка для входа уже использована — нажмите «Открыть приложение» в боте ещё раз.');
    expect(text(html)).not.toContain('устарела');
    expect(text(html)).toContain('Это кабинет работника');
  });

  it('error=link — «Ссылка недействительна…» и тот же экран работника', async () => {
    const html = await render({ for: 'worker', error: 'link' });
    expect(text(html)).toContain('Ссылка недействительна или устарела. Попросите у администратора новую.');
    expect(text(html)).toContain('Это кабинет работника');
    expect(text(html)).not.toContain('Ссылка для входа устарела');
  });
});

describe('/login?for=worker при входе менеджера', () => {
  it('не уводит молча в «Месяц»: «Вы вошли как менеджер. Это страница работника», «Перейти в «Месяц»», подсказка про другой браузер', async () => {
    auth.manager = true;
    const html = await render({ for: 'worker' });
    expect(text(html)).toContain('Вы вошли как менеджер');
    expect(text(html)).toContain('Это страница работника.');
    expect(html).toMatch(/<a [^>]*href="\/month"[^>]*>(?:(?!<\/a>)[\s\S])*Перейти в «Месяц»<\/a>/);
    expect(text(html)).toContain('в другом браузере');
    expect(html).not.toContain('type="password"');
    expect(text(html)).not.toContain('Это кабинет работника');
  });

  it('то же для устаревшей ссылки из бота', async () => {
    auth.manager = true;
    const html = await render({ error: 'tg' });
    expect(text(html)).toContain('Вы вошли как менеджер');
  });

  it('просто /login у менеджера — в «Месяц», как раньше', async () => {
    auth.manager = true;
    await expect(render({})).rejects.toThrow(/^redirect:\/month$/);
    await expect(render({ for: 'manager' })).rejects.toThrow(/^redirect:\/month$/);
  });
});

describe('/login без параметров — вход менеджера, как раньше', () => {
  it('форма открыта, экрана работника нет', async () => {
    const html = await render({});
    expect(text(html)).toContain('Вход для менеджера');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('<details');
    expect(text(html)).not.toContain('Это кабинет работника');
  });

  it('открыт кабинет работника — подсказка «Перейти к сменам» на обоих экранах', async () => {
    auth.worker = { id: 'w1', fullName: 'Илья <b>' };
    for (const params of [{}, { for: 'worker' }] as Array<Record<string, string>>) {
      const html = await render(params);
      expect(text(html)).toContain('Сейчас открыт кабинет работника «Илья &lt;b&gt;».');
      expect(html).toMatch(/href="\/shifts"/);
    }
  });
});
