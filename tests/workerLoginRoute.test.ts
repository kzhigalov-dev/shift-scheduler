import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Tx } from '@/db/client';
import { resetTestDb, testSql, asWorker, asAppAnon, asManager } from './setup';
import { hashToken } from '@/lib/auth/token';
import { issueWorkerLoginCode, workerBySession } from '@/lib/auth/workerSession';
import { chatOf, linkWorkerChat } from './loginFixtures';

// Вход по ссылкам работника целиком: cookie — из jar, redirect — исключение с адресом,
// база — тестовая под ролью приложения (withAnon → asAppAnon и т. д.).
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => { jar.set(name, value); },
    delete: (c: string | { name: string }) => { jar.delete(typeof c === 'string' ? c : c.name); },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
vi.mock('@/db/client', async () => {
  const setup = await import('./setup');
  return {
    withAnon: <T>(fn: (tx: Tx) => Promise<T>) => setup.asAppAnon(fn),
    withManager: <T>(fn: (tx: Tx) => Promise<T>) => setup.asManager(fn),
    withWorker: <T>(id: string, fn: (tx: Tx) => Promise<T>) => setup.asWorker(id, fn),
  };
});

const { default: TgLoginPage } = await import('@/app/tg/[code]/page');
const { confirmLoginAction, confirmPersonalLinkAction } = await import('@/app/tg/actions');
const w = await import('@/app/w/[token]/route');
const { default: PersonalLinkConfirmPage } = await import('@/app/w/[token]/confirm/page');
const up = await import('@/app/auth/upgrade/route');
const { issueToken } = await import('@/app/(manager)/workers/operations');
const { getCurrentWorker, isManager } = await import('@/lib/auth/session');

let ian: string;
let pol: string;

beforeEach(async () => {
  await resetTestDb();
  jar.clear();
  [{ id: ian }] = await testSql`insert into worker (full_name, name_key, token_hash)
    values ('Ян', 'ян', ${hashToken('ian-personal-token')}) returning id`;
  [{ id: pol }] = await testSql`insert into worker (full_name, name_key, token_hash)
    values ('Полина', 'полина', ${hashToken('pol-personal-token')}) returning id`;
  await linkWorkerChat(ian);
});

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** GET /tg/<код>?… — страница (серверный компонент → HTML). */
async function open(code: string, query: Record<string, string> = {}): Promise<string> {
  const page = await TgLoginPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(page);
}
/** POST формы подтверждения. */
const confirm = (code: string, to = '') => {
  const form = new FormData();
  form.set('code', code);
  form.set('to', to);
  return confirmLoginAction(form);
};
const issue = async () => (await asWorker(ian, (tx) => issueWorkerLoginCode(tx, chatOf(ian)))) ?? '';
const managerCookie = async () => {
  const token = 'm'.repeat(43);
  await testSql`insert into manager_session (token_hash, expires_at) values (${hashToken(token)}, now() + interval '1 hour')`;
  jar.set('manager_session', token);
  return token;
};
const used = async () => (await testSql`select used_at from worker_login_code`).map((r) => r.used_at !== null);

describe('GET /tg/[code] — подтверждение без побочных эффектов (L3)', () => {
  it('«Войти как Ян?» и кнопка; код не гасится, cookie и сессия менеджера не трогаются', async () => {
    const code = await issue();
    const token = await managerCookie();
    const html = await open(code, { to: '/available' });
    expect(text(html)).toContain('Войти как Ян?');
    expect(text(html)).toContain('Вход менеджера в этом браузере закроется');
    expect(html).toMatch(/<form[^>]*>[\s\S]*<input type="hidden" name="code" value="[^"]+"[\s\S]*<button[^>]*type="submit"[^>]*>[\s\S]*Войти/);
    expect(html).toContain('name="to" value="/available"');
    expect(await used()).toEqual([false]);
    expect([...jar.keys()]).toEqual(['manager_session']);
    expect(await testSql`select 1 from manager_session where token_hash = ${hashToken(token)}`).toHaveLength(1);
  });

  it('другой работник в этом браузере — его кабинет закроется', async () => {
    jar.set('worker_token', 'pol-personal-token');
    expect(text(await open(await issue()))).toContain('Кабинет «Полина» в этом браузере закроется');
  });

  it('`to` в форме — только из белого списка', async () => {
    const code = await issue();
    for (const to of ['https://evil.example', '//evil.example', '/month']) {
      expect(await open(code, { to })).toContain('name="to" value="/shifts"');
    }
  });

  it('истёкший, неверный, чужой формы код и код архивного работника — /login?error=tg', async () => {
    const expired = await issue();
    await testSql`update worker_login_code set expires_at = now() - interval '1 second'`;
    await expect(open(expired)).rejects.toThrow(/^redirect:\/login\?error=tg$/);
    for (const bad of ['x', 'A'.repeat(43), '../w/abc']) {
      await expect(open(bad)).rejects.toThrow(/^redirect:\/login\?error=tg$/);
    }
    await testSql`update worker_login_code set created_at = now() - interval '1 minute'`;
    const archived = await issue();
    await testSql`update worker set status = 'archived' where id = ${ian}`;
    await expect(open(archived)).rejects.toThrow(/^redirect:\/login\?error=tg$/);
    expect(jar.size).toBe(0);
  });
});

describe('POST подтверждения: вход и закрытие прежних ролей — одной транзакцией (L3, L4)', () => {
  it('код гасится, cookie worker_session, сессия менеджера закрыта, редирект на путь из белого списка', async () => {
    const code = await issue();
    const token = await managerCookie();
    await expect(confirm(code, '/available')).rejects.toThrow(/^redirect:\/available$/);
    const session = jar.get('worker_session') ?? '';
    expect(await asAppAnon((tx) => workerBySession(tx, session))).toEqual({ id: ian, fullName: 'Ян' });
    expect(await getCurrentWorker()).toEqual({ id: ian, fullName: 'Ян' });
    expect(jar.has('manager_session')).toBe(false);
    expect(await testSql`select 1 from manager_session where token_hash = ${hashToken(token)}`).toEqual([]);
    expect(await isManager()).toBe(false);
  });

  it.each([
    ['https://evil.example', '/shifts'], ['//evil.example', '/shifts'], ['/month', '/shifts'],
    ['', '/shifts'], ['/earnings?month=2099-07', '/earnings?month=2099-07'], ['/notifications', '/notifications'],
  ])('`to` %s → %s', async (to, target) => {
    await expect(confirm(await issue(), to)).rejects.toThrow(new RegExp(`^redirect:${target.replace(/[?]/g, '\\?')}$`));
  });

  it('прежняя сессия из бота этого браузера закрывается в той же транзакции', async () => {
    await expect(confirm(await issue())).rejects.toThrow(/^redirect:\/shifts$/);
    const first = jar.get('worker_session') ?? '';
    await testSql`update worker_login_code set created_at = now() - interval '1 minute'`;
    await expect(confirm(await issue())).rejects.toThrow(/^redirect:\/shifts$/);
    expect(jar.get('worker_session')).not.toBe(first);
    expect(await asAppAnon((tx) => workerBySession(tx, first))).toBeNull();
  });

  it('сбой закрытия сессии менеджера откатывает и погашение кода — ссылка остаётся рабочей', async () => {
    const code = await issue();
    await managerCookie();
    await testSql`revoke execute on function end_manager_session(text) from app_user`;
    await expect(confirm(code)).rejects.toThrow(/permission denied/);
    expect(await used()).toEqual([false]);
    expect(await testSql`select 1 from worker_session`).toEqual([]);
    expect(jar.has('worker_session')).toBe(false);
    await testSql`grant execute on function end_manager_session(text) to app_user`;
    await expect(confirm(code)).rejects.toThrow(/^redirect:\/shifts$/);
  });

  it('повтор после успешного входа: с cookie — сразу в приложение, без неё — «уже использована», не «устарела»', async () => {
    const code = await issue();
    await expect(confirm(code, '/available')).rejects.toThrow(/^redirect:\/available$/);
    // Тот же браузер (повтор запроса, вторая вкладка): уже вошёл — туда же.
    await expect(confirm(code, '/available')).rejects.toThrow(/^redirect:\/available$/);
    await expect(open(code, { to: '/available' })).rejects.toThrow(/^redirect:\/available$/);
    // Другой браузер без входа.
    jar.clear();
    await expect(confirm(code)).rejects.toThrow(/^redirect:\/login\?error=tg-used$/);
    await expect(open(code)).rejects.toThrow(/^redirect:\/login\?error=tg-used$/);
    expect(jar.has('worker_session')).toBe(false);
  });

  it('истёкший код при подтверждении — /login?error=tg, cookie не трогаются', async () => {
    const code = await issue();
    jar.set('manager_session', 'x');
    await testSql`update worker_login_code set expires_at = now() - interval '1 second'`;
    await expect(confirm(code)).rejects.toThrow(/^redirect:\/login\?error=tg$/);
    expect([...jar.entries()]).toEqual([['manager_session', 'x']]);
  });
});

describe('/w/[token] — личная ссылка (L6: GET ничего не меняет, вход — POST, в cookie — сессия)', () => {
  const visit = (token: string) => w.GET(new Request(`https://a.app/w/${token}`), { params: Promise.resolve({ token }) });
  const location = (res: Response) => res.headers.get('location');
  const loginByLink = (token = 'ian-personal-token') => {
    const form = new FormData();
    form.set('token', token);
    return confirmPersonalLinkAction(form);
  };
  const linkSessions = () => testSql`select worker_id, chat_id, expires_at > now() + interval '364 days' as year
    from worker_session where chat_id is null`;

  it('GET без роли — «Войти как…?»: ни cookie, ни сессии; ответ не кешируется', async () => {
    const res = await visit('ian-personal-token');
    expect(res.status).toBe(307);
    expect(location(res)).toBe('/w/ian-personal-token/confirm');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(jar.size).toBe(0);
    expect(await testSql`select 1 from worker_session`).toEqual([]);
  });

  it('POST «Войти»: в cookie — токен сессии (не ссылки), сессия без чата на год', async () => {
    await expect(loginByLink()).rejects.toThrow(/^redirect:\/shifts$/);
    expect(jar.has('worker_token')).toBe(false);
    const session = jar.get('worker_session') ?? '';
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session).not.toBe('ian-personal-token');
    expect(await linkSessions()).toEqual([{ worker_id: ian, chat_id: null, year: true }]);
    expect(await getCurrentWorker()).toEqual({ id: ian, fullName: 'Ян' });
  });

  it('браузер уже вошёл этим работником — GET сразу в приложение', async () => {
    await expect(loginByLink()).rejects.toThrow(/^redirect:\/shifts$/);
    expect(location(await visit('ian-personal-token'))).toBe('/shifts');
  });

  it('вошёл менеджер или другой работник — подтверждение, GET ничего не закрывает', async () => {
    const token = await managerCookie();
    expect(location(await visit('ian-personal-token'))).toBe('/w/ian-personal-token/confirm');
    expect([...jar.keys()]).toEqual(['manager_session']);
    expect(await testSql`select 1 from manager_session where token_hash = ${hashToken(token)}`).toHaveLength(1);
    jar.clear();
    await expect(loginByLink('pol-personal-token')).rejects.toThrow(/^redirect:\/shifts$/);
    const polSession = jar.get('worker_session');
    expect(location(await visit('ian-personal-token'))).toBe('/w/ian-personal-token/confirm');
    expect(jar.get('worker_session')).toBe(polSession);
  });

  it('страница подтверждения — «Войти как Ян?», без побочных эффектов; POST входит и закрывает менеджера', async () => {
    const token = await managerCookie();
    const page = await PersonalLinkConfirmPage({ params: Promise.resolve({ token: 'ian-personal-token' }) });
    const html = renderToStaticMarkup(page);
    expect(text(html)).toContain('Войти как Ян?');
    expect(text(html)).toContain('Вход менеджера в этом браузере закроется');
    expect([...jar.keys()]).toEqual(['manager_session']);
    await expect(loginByLink()).rejects.toThrow(/^redirect:\/shifts$/);
    expect(jar.has('manager_session')).toBe(false);
    expect(await testSql`select 1 from manager_session where token_hash = ${hashToken(token)}`).toEqual([]);
  });

  it('вход по личной ссылке закрывает сессию из бота в этом браузере', async () => {
    await expect(confirm(await issue())).rejects.toThrow(/^redirect:\/shifts$/);
    const botSession = jar.get('worker_session') ?? '';
    await expect(loginByLink()).rejects.toThrow(/^redirect:\/shifts$/);
    expect(jar.get('worker_session')).not.toBe(botSession);
    expect(await asAppAnon((tx) => workerBySession(tx, botSession))).toBeNull();
    expect(await getCurrentWorker()).toEqual({ id: ian, fullName: 'Ян' });
  });

  it('перевыпуск ссылки закрывает и сессию, полученную по ней; отключение Telegram — нет', async () => {
    await expect(loginByLink()).rejects.toThrow(/^redirect:\/shifts$/);
    await testSql`delete from telegram_link where worker_id = ${ian}`;
    expect(await getCurrentWorker()).toEqual({ id: ian, fullName: 'Ян' });
    await asManager((tx) => issueToken(tx, ian));
    expect(await getCurrentWorker()).toBeNull();
  });

  it('недействительная ссылка — /login?error=link, cookie не трогаются', async () => {
    jar.set('manager_session', 'x');
    expect(location(await visit('чужой'))).toBe('/login?error=link');
    await expect(loginByLink('чужой')).rejects.toThrow(/^redirect:\/login\?error=link$/);
    expect([...jar.entries()]).toEqual([['manager_session', 'x']]);
    const page = PersonalLinkConfirmPage({ params: Promise.resolve({ token: 'чужой' }) });
    await expect(page).rejects.toThrow(/^redirect:\/login\?error=link$/);
    void pol;
  });
});

describe('/auth/upgrade — старая cookie worker_token (сырой токен ссылки) меняется на сессию (L6)', () => {
  const upgrade = (to: string) => up.GET(new Request(`https://a.app/auth/upgrade?to=${encodeURIComponent(to)}`));
  const location = (res: Response) => res.headers.get('location');

  it('действующая — сессия вместо неё, старая удалена, обратно туда, куда шли', async () => {
    jar.set('worker_token', 'ian-personal-token');
    expect(await getCurrentWorker()).toEqual({ id: ian, fullName: 'Ян' });
    const res = await upgrade('/available?x=1');
    expect(location(res)).toBe('/available?x=1');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(jar.has('worker_token')).toBe(false);
    expect(await asAppAnon((tx) => workerBySession(tx, jar.get('worker_session') ?? ''))).toEqual({ id: ian, fullName: 'Ян' });
  });

  it('ссылку перевыпустили — cookie удалена, на /login с пояснением', async () => {
    jar.set('worker_token', 'устаревший');
    expect(location(await upgrade('/shifts'))).toBe('/login?for=worker&error=link');
    expect(jar.size).toBe(0);
    expect(await testSql`select 1 from worker_session`).toEqual([]);
  });

  it('to — только путь этого сайта', async () => {
    for (const to of ['//evil.example/x', 'https://evil.example/x', '/\\evil.example', 'javascript:alert(1)', '']) {
      expect(location(await upgrade(to))).toBe('/');
    }
  });
});
