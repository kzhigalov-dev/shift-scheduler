import { describe, it, expect, vi, beforeEach } from 'vitest';

// session.ts читает cookie через next/headers и уходит через redirect —
// обе зависимости подменяются: здесь проверяется только выбор адреса и cookie.
const jar = new Map<string, string>();
/** Атрибуты последней записи и удаления каждой cookie — для проверки Secure / Path / __Host- (L7). */
const attrs = new Map<string, Record<string, unknown>>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => { jar.set(name, value); attrs.set(name, options); },
    delete: (c: string | { name: string }) => {
      const name = typeof c === 'string' ? c : c.name;
      jar.delete(name);
      attrs.set(`deleted:${name}`, typeof c === 'string' ? {} : c);
    },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));
const findWorkerByToken = vi.fn();
const findWorkerBySession = vi.fn();
vi.mock('@/lib/auth/workerLookup', () => ({
  findWorkerByToken: (t: string) => findWorkerByToken(t),
  findWorkerBySession: (t: string) => findWorkerBySession(t),
}));

vi.mock('@/db/client', () => ({
  withAnon: async (fn: (tx: unknown) => unknown) => fn({}),
  withManager: async (fn: (tx: unknown) => unknown) => fn({}),
}));
const deleteManagerSession = vi.fn();
vi.mock('@/lib/auth/managerSession', () => ({
  createManagerSession: async () => 'manager-token',
  isManagerSessionValid: vi.fn(),
  deleteManagerSession: (_tx: unknown, t: string) => deleteManagerSession(t),
  MANAGER_SESSION_HOURS: 12,
}));
const endWorkerSession = vi.fn();
const endManagerSessionByToken = vi.fn();
const personalLinkLogin = vi.fn();
vi.mock('@/lib/auth/workerSession', () => ({
  endWorkerSession: (_tx: unknown, t: string) => endWorkerSession(t),
  endManagerSessionByToken: (_tx: unknown, t: string) => endManagerSessionByToken(t),
  personalLinkLogin: (_tx: unknown, link: string, session: string) => personalLinkLogin(link, session),
  redeemWorkerLoginCode: vi.fn(),
}));

const {
  requireWorker, getCurrentWorker, startManagerSession, loginWithPersonalLink, openWorkerSession, isManager,
  upgradeLegacyCookies,
} = await import('@/lib/auth/session');
const { isManagerSessionValid } = await import('@/lib/auth/managerSession');

const ILYA = { id: 'w1', fullName: 'Илья' };
const OLGA = { id: 'w2', fullName: 'Ольга' };

beforeEach(() => {
  jar.clear();
  attrs.clear();
  vi.unstubAllEnvs();
  personalLinkLogin.mockReset();
  personalLinkLogin.mockResolvedValue(true);
  findWorkerByToken.mockReset();
  findWorkerBySession.mockReset();
  deleteManagerSession.mockReset();
  endWorkerSession.mockReset();
  endManagerSessionByToken.mockReset();
});
const openBotSession = (session: string | null) => openWorkerSession(async () => ({ session, result: session !== null }));

describe('requireWorker', () => {
  it('без cookie — на /login?for=worker', async () => {
    await expect(requireWorker()).rejects.toThrow(/^redirect:\/login\?for=worker$/);
  });

  it('cookie есть, но ссылка недействительна (перевыпуск, архив) — на /login?for=worker&error=link', async () => {
    jar.set('worker_token', 'old-token');
    findWorkerByToken.mockResolvedValue(null);
    await expect(requireWorker()).rejects.toThrow(/^redirect:\/login\?for=worker&error=link$/);
  });

  it('сессия из бота недействительна — так же', async () => {
    jar.set('worker_session', 'old-session');
    findWorkerBySession.mockResolvedValue(null);
    await expect(requireWorker()).rejects.toThrow(/^redirect:\/login\?for=worker&error=link$/);
  });

  it('действующая cookie — работник', async () => {
    jar.set('worker_token', 'good-token');
    findWorkerByToken.mockResolvedValue(ILYA);
    await expect(requireWorker()).resolves.toEqual(ILYA);
  });
});

describe('getCurrentWorker: старая cookie личной ссылки и новая сессия из бота', () => {
  it('только worker_token', async () => {
    jar.set('worker_token', 'good-token');
    findWorkerByToken.mockResolvedValue(ILYA);
    await expect(getCurrentWorker()).resolves.toEqual(ILYA);
    expect(findWorkerByToken).toHaveBeenCalledWith('good-token');
  });

  it('только worker_session', async () => {
    jar.set('worker_session', 'good-session');
    findWorkerBySession.mockResolvedValue(OLGA);
    await expect(getCurrentWorker()).resolves.toEqual(OLGA);
    expect(findWorkerBySession).toHaveBeenCalledWith('good-session');
    expect(findWorkerByToken).not.toHaveBeenCalled();
  });

  it('сессия недействительна, личная ссылка действует — работник по ссылке', async () => {
    jar.set('worker_session', 'old-session');
    jar.set('worker_token', 'good-token');
    findWorkerBySession.mockResolvedValue(null);
    findWorkerByToken.mockResolvedValue(ILYA);
    await expect(getCurrentWorker()).resolves.toEqual(ILYA);
  });

  it('без cookie — null без обращения к базе', async () => {
    await expect(getCurrentWorker()).resolves.toBeNull();
    expect(findWorkerByToken).not.toHaveBeenCalled();
    expect(findWorkerBySession).not.toHaveBeenCalled();
  });
});

describe('один браузер — одна роль', () => {
  it('вход менеджера закрывает кабинет работника: обе cookie и сессию из бота в базе', async () => {
    jar.set('worker_token', 'good-token');
    jar.set('worker_session', 'good-session');
    await startManagerSession();
    expect(jar.has('worker_token')).toBe(false);
    expect(jar.has('worker_session')).toBe(false);
    expect(endWorkerSession).toHaveBeenCalledWith('good-session');
    expect(jar.get('manager_session')).toBe('manager-token');
  });

  it('вход по личной ссылке: в cookie — новая сессия, не токен ссылки; закрыты менеджер и прежняя сессия (L6)', async () => {
    jar.set('manager_session', 'm-token');
    jar.set('worker_session', 'good-session');
    expect(await loginWithPersonalLink('link-token')).toBe(true);
    const [link, session] = personalLinkLogin.mock.calls[0] as [string, string];
    expect(link).toBe('link-token');
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(endManagerSessionByToken).toHaveBeenCalledWith('m-token');
    expect(endWorkerSession).toHaveBeenCalledWith('good-session');
    expect(jar.has('manager_session')).toBe(false);
    expect(jar.has('worker_token')).toBe(false);
    expect(jar.get('worker_session')).toBe(session);
  });

  it('недействительная личная ссылка — cookie не трогаются', async () => {
    personalLinkLogin.mockResolvedValue(false);
    jar.set('manager_session', 'm-token');
    expect(await loginWithPersonalLink('bad')).toBe(false);
    expect([...jar.keys()]).toEqual(['manager_session']);
    expect(await loginWithPersonalLink('')).toBe(false);
  });

  it('вход из бота закрывает сессию менеджера, прежнюю сессию и cookie личной ссылки', async () => {
    jar.set('manager_session', 'm-token');
    jar.set('worker_session', 'old-session');
    jar.set('worker_token', 'old-token');
    expect(await openBotSession('new-session')).toBe(true);
    expect(endManagerSessionByToken).toHaveBeenCalledWith('m-token');
    expect(endWorkerSession).toHaveBeenCalledWith('old-session');
    expect(jar.has('manager_session')).toBe(false);
    expect(jar.has('worker_token')).toBe(false);
    expect(jar.get('worker_session')).toBe('new-session');
  });

  it('вход из бота не принят — ни сессии, ни cookie не трогаются', async () => {
    jar.set('manager_session', 'm-token');
    expect(await openBotSession(null)).toBe(false);
    expect(endManagerSessionByToken).not.toHaveBeenCalled();
    expect([...jar.keys()]).toEqual(['manager_session']);
  });

  it('без чужих cookie — ничего не удаляется в базе', async () => {
    await openBotSession('new-session');
    jar.clear();
    await loginWithPersonalLink('new-token');
    expect(deleteManagerSession).not.toHaveBeenCalled();
    expect(endManagerSessionByToken).not.toHaveBeenCalled();
    expect(endWorkerSession).not.toHaveBeenCalled();
  });
});

describe('переход со старой cookie личной ссылки (L6)', () => {
  it('worker_token ещё читается до переноса', async () => {
    jar.set('worker_token', 'good-token');
    findWorkerByToken.mockResolvedValue(ILYA);
    await expect(getCurrentWorker()).resolves.toEqual(ILYA);
  });

  it('перенос: действующий токен — сессия вместо него, старая cookie удалена', async () => {
    jar.set('worker_token', 'good-token');
    expect(await upgradeLegacyCookies()).toBe('ok');
    expect(personalLinkLogin).toHaveBeenCalledWith('good-token', expect.any(String));
    expect(jar.has('worker_token')).toBe(false);
    expect(jar.get('worker_session')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('перенос: ссылку перевыпустили — cookie удалена, link-invalid', async () => {
    personalLinkLogin.mockResolvedValue(false);
    jar.set('worker_token', 'old-token');
    expect(await upgradeLegacyCookies()).toBe('link-invalid');
    expect(jar.size).toBe(0);
  });

  it('перенос: уже есть действующая сессия или менеджер — старая cookie просто удаляется', async () => {
    jar.set('worker_token', 'good-token');
    jar.set('worker_session', 'good-session');
    findWorkerBySession.mockResolvedValue(OLGA);
    expect(await upgradeLegacyCookies()).toBe('ok');
    expect(personalLinkLogin).not.toHaveBeenCalled();
    expect([...jar.keys()]).toEqual(['worker_session']);
    jar.clear();
    jar.set('worker_token', 'good-token');
    jar.set('manager_session', 'm-token');
    expect(await upgradeLegacyCookies()).toBe('ok');
    expect(personalLinkLogin).not.toHaveBeenCalled();
    expect(deleteManagerSession).not.toHaveBeenCalled();
    expect([...jar.keys()]).toEqual(['manager_session']);
  });

  it('без старых cookie — ничего не делает', async () => {
    jar.set('worker_session', 's');
    expect(await upgradeLegacyCookies()).toBe('ok');
    expect([...jar.keys()]).toEqual(['worker_session']);
  });
});

describe('на бою — cookie __Host- (L7)', () => {
  beforeEach(() => { vi.stubEnv('NODE_ENV', 'production'); });

  it('вход менеджера пишет __Host-manager_session: Secure, Path=/, без Domain, httpOnly, Lax', async () => {
    await startManagerSession();
    expect(jar.get('__Host-manager_session')).toBe('manager-token');
    expect(jar.has('manager_session')).toBe(false);
    const a = attrs.get('__Host-manager_session') ?? {};
    expect(a).toMatchObject({ secure: true, path: '/', httpOnly: true, sameSite: 'lax' });
    expect(a).not.toHaveProperty('domain');
  });

  it('вход работника пишет __Host-worker_session и удаляет прежние имена', async () => {
    jar.set('worker_session', 'old-session');
    jar.set('worker_token', 'old-token');
    expect(await openBotSession('new-session')).toBe(true);
    expect([...jar.entries()]).toEqual([['__Host-worker_session', 'new-session']]);
    expect(attrs.get('__Host-worker_session')).toMatchObject({ secure: true, path: '/' });
  });

  it('прежние имена ещё читаются: никого не выкидывает при выкладке', async () => {
    jar.set('worker_session', 'good-session');
    findWorkerBySession.mockResolvedValue(OLGA);
    await expect(getCurrentWorker()).resolves.toEqual(OLGA);
    jar.clear();
    jar.set('manager_session', 'm');
    vi.mocked(isManagerSessionValid).mockResolvedValue(true);
    await expect(isManager()).resolves.toBe(true);
    expect(isManagerSessionValid).toHaveBeenCalledWith({}, 'm');
  });

  it('удаление __Host- — тоже с Secure и Path=/ (иначе браузер его не примет)', async () => {
    jar.set('__Host-manager_session', 'm');
    jar.set('__Host-worker_session', 's');
    await startManagerSession();
    expect(attrs.get('deleted:__Host-worker_session')).toMatchObject({ secure: true, path: '/' });
  });

  it('перенос: прежние имена — под __Host-, старые удаляются', async () => {
    jar.set('manager_session', 'm');
    jar.set('worker_session', 's');
    expect(await upgradeLegacyCookies()).toBe('ok');
    expect(Object.fromEntries(jar)).toEqual({ '__Host-manager_session': 'm', '__Host-worker_session': 's' });
    expect(attrs.get('__Host-manager_session')).toMatchObject({ secure: true, maxAge: 12 * 60 * 60 });
  });

  it('локально (не production) — прежние имена без Secure', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await startManagerSession();
    expect(jar.get('manager_session')).toBe('manager-token');
    expect(attrs.get('manager_session')).toMatchObject({ secure: false, path: '/' });
  });
});
