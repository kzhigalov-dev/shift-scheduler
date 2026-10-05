import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Структурная проверка прав. Проверка в layout.tsx не защищает ничего:
 * при клиентской навигации layout не перерисовывается, а страница, action
 * и route рендерятся/выполняются независимо от него. Поэтому каждая
 * страница, action и route проверяет права сам — первым оператором.
 *
 * Первый оператор сравнивается с явным списком допустимых форм (FORMS),
 * а не ищется «где-нибудь в теле»: закомментированная проверка или
 * проверка после обращения к базе тест роняют.
 */

const APP = path.resolve(__dirname, '../src/app');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(APP);
const rel = (file: string) => path.relative(APP, file).split(path.sep).join('/');
const raw = (file: string) => readFileSync(file, 'utf8');

/**
 * Убирает комментарии `//…` и `/*…*\/` вне строковых литералов ('…', "…", `…`).
 * Если разбор не сходится (строка не закрыта, перевод строки внутри '…') —
 * бросает ошибку: лучше упасть, чем молча пропустить проверку.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new Error('незакрытый /* комментарий');
      out += ' ';
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (c !== '`' && src[j] === '\n') throw new Error(`перевод строки внутри ${c}-строки`);
        j++;
      }
      if (j >= src.length) throw new Error(`незакрытая ${c}-строка`);
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const cache = new Map<string, string>();
/** Исходник без комментариев. */
function source(file: string): string {
  if (!cache.has(file)) cache.set(file, stripComments(raw(file)));
  return cache.get(file) as string;
}

type Fn = { name: string; exported: boolean; isDefault: boolean; body: string };

/** Объявления `function name(...) {...}` с телами (скобки считаются по коду без комментариев). */
function functions(src: string): Fn[] {
  const re = /(export\s+)?(default\s+)?(async\s+)?function\s+(\w+)\s*\(/g;
  const result: Fn[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let i = re.lastIndex;
    for (let depth = 1; depth > 0; i++) {
      if (i >= src.length) throw new Error(`не найден конец параметров ${m[4]}`);
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    // Тип результата вроде Promise<{ error: string }> — фигурные скобки внутри <> не тело.
    for (let angle = 0; !(src[i] === '{' && angle === 0); i++) {
      if (i >= src.length) throw new Error(`не найдено тело ${m[4]}`);
      if (src[i] === '<') angle++;
      else if (src[i] === '>' && src[i - 1] !== '=') angle--;
    }
    const start = i + 1;
    for (let depth = 1, j = start; ; j++) {
      if (j >= src.length) throw new Error(`не найден конец функции ${m[4]}`);
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      if (depth === 0) {
        result.push({
          name: m[4], exported: Boolean(m[1]), isDefault: Boolean(m[2]),
          body: src.slice(start, j),
        });
        break;
      }
    }
  }
  return result;
}

/** Тело без лишних пробелов: сравнение с формами не зависит от переносов строк. */
const head = (body: string) => body.replace(/\s+/g, ' ').trim();

/**
 * Допустимые первые операторы — перечислены явно. Сравниваются с началом
 * тела функции (после удаления комментариев и схлопывания пробелов).
 */
const FORMS = {
  /** `await requireManager();` */
  requireManager: /^await requireManager\(\);/,
  /** `await requireWorker();` или `const worker = await requireWorker();` */
  requireWorker: /^(const \w+ = )?await requireWorker\(\);/,
  /** Развилка по роли в общих страницах: `if (await isManager()) …`. */
  roleSwitch: /^if \(await isManager\(\)\) /,
  /** Route: `if (!(await isManager())) return …;` или `{ return …; }`. */
  routeIsManager: /^if \(!\(await isManager\(\)\)\) (return |\{ return )/,
};
const PAGE_MANAGER = [FORMS.requireManager];
const PAGE_WORKER = [FORMS.requireWorker];
const ROUTE = [FORMS.routeIsManager, FORMS.requireManager, FORMS.requireWorker];
/** Actions — ещё `return run(` через локальную обёртку с проверкой (см. ниже). */
const ACTION = [FORMS.requireManager, FORMS.requireWorker];

const startsWithAny = (body: string, forms: RegExp[]) => forms.some((f) => f.test(head(body)));

const DB_CALL = /\bwith(Manager|Worker|Anon)\s*\(/;

/**
 * Экспорт не через `function` (стрелки, `export { … }`, `export *`) функция
 * functions() не видит — поэтому он запрещён. Исключение — настройки сегмента
 * с литеральным значением (`export const maxDuration = 60;`).
 */
const SEGMENT_CONFIG = /^export const (maxDuration|dynamic|dynamicParams|revalidate|runtime|preferredRegion|fetchCache) = ('[\w-]*'|\d+|true|false);$/;
function hiddenExports(src: string, allowSegmentConfig: boolean): string[] {
  return src.split('\n').map((l) => l.trim()).filter((l) =>
    (/^export\s+(const|let|var|class)\s/.test(l) && !(allowSegmentConfig && SEGMENT_CONFIG.test(l)))
    || /^export\s*[{*]/.test(l)
    || /^export\s+default\s+(?!(async\s+)?function\s)/.test(l));
}

describe('разбор исходников', () => {
  it('stripComments убирает комментарии, но не трогает строки', () => {
    expect(head(stripComments('// await requireManager();\nconst a = 1;'))).toBe('const a = 1;');
    expect(head(stripComments('/* await requireManager(); */ x();'))).toBe('x();');
    expect(stripComments("const u = 'http://x/*y*/';")).toBe("const u = 'http://x/*y*/';");
    expect(stripComments('const t = `a // b`;')).toBe('const t = `a // b`;');
    expect(() => stripComments("const s = 'oops;\n")).toThrow();
  });

  it('формы первого оператора не пропускают закомментированное и чужое', () => {
    const body = (s: string) => stripComments(s);
    expect(startsWithAny(body('\n  await requireManager();\n  x();'), PAGE_MANAGER)).toBe(true);
    expect(startsWithAny(body('\n  // await requireManager();\n  x();'), PAGE_MANAGER)).toBe(false);
    expect(startsWithAny(body('const a = 1; await requireManager();'), PAGE_MANAGER)).toBe(false);
    expect(startsWithAny(body('void requireManager();'), PAGE_MANAGER)).toBe(false);
    expect(startsWithAny(body('const worker = await requireWorker();'), PAGE_WORKER)).toBe(true);
    expect(startsWithAny(body("if (!(await isManager())) return new Response('', { status: 401 });"), ROUTE)).toBe(true);
    expect(startsWithAny(body('if (!(await isManager())) {}'), ROUTE)).toBe(false);
  });

  it('все файлы src/app разбираются без ошибок', () => {
    for (const file of files.filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(() => functions(source(file)), rel(file)).not.toThrow();
    }
  });
});

const pages = files.filter((f) => path.basename(f) === 'page.tsx');
const managerPages = pages.filter((f) => rel(f).startsWith('(manager)/'));
const workerPages = pages.filter((f) => rel(f).startsWith('(worker)/'));

/** Страницы вне групп: публичные или с собственной развилкой по ролям. */
const OTHER_PAGES: Record<string, RegExp> = {
  // Только редирект по роли, данных нет.
  'page.tsx': FORMS.roleSwitch,
  // Страница входа: до входа прав нет по определению.
  'login/page.tsx': FORMS.roleSwitch,
  // Общая для менеджера и работника: без роли — requireWorker → /login.
  'instructions/page.tsx': FORMS.roleSwitch,
  // Подтверждение входа из бота: права — сам одноразовый код из адреса, его состояние читает
  // loginCodeInfo (security definer) и ничего не меняет; вход — только POST (tg/actions.ts).
  'tg/[code]/page.tsx': /^const \{ code \} = await params; const query = await searchParams; const to = loginTarget\([^;]*\); const info = await loginCodeInfo\(code\);/,
  // Подтверждение личной ссылки при другой роли в браузере: токен из адреса проверяется
  // findWorkerByToken (security definer) до показа имени; вход — только POST (tg/actions.ts).
  // Mini App: данных нет, в базу страница не ходит; вход — POST webAppLoginAction с initData из адреса.
  'tg/app/page.tsx': /^const query = await searchParams; const to = loginTarget\(/,
  'w/[token]/confirm/page.tsx': /^const \{ token \} = await params; const worker = await findWorkerByToken\(token\); if \(!worker\) redirect\('\/login\?error=link'\);/,
};

/**
 * Каждая экспортируемая функция страницы (сама страница, generateMetadata,
 * generateViewport…) проверяется одинаково: первым оператором — проверка прав.
 */
function checkPage(file: string, forms: RegExp[]) {
  const src = source(file);
  expect(hiddenExports(src, true), rel(file)).toEqual([]);
  const exported = functions(src).filter((f) => f.exported);
  expect(exported.some((f) => f.isDefault), `${rel(file)}: нет export default function`).toBe(true);
  for (const fn of exported) {
    expect(startsWithAny(fn.body, forms), `${rel(file)} ${fn.name}: первый оператор — не проверка прав`).toBe(true);
  }
}

describe('страницы проверяют права сами, первым оператором', () => {
  it('страницы найдены', () => {
    expect(managerPages.length).toBeGreaterThanOrEqual(6);
    expect(workerPages.length).toBeGreaterThanOrEqual(3);
  });

  it('каждая страница — в группе (manager)/(worker) или в списке известных', () => {
    const unknown = pages
      .map(rel)
      .filter((r) => !r.startsWith('(manager)/') && !r.startsWith('(worker)/') && !(r in OTHER_PAGES));
    expect(unknown).toEqual([]);
  });

  it.each(managerPages.map((f) => [rel(f), f]))('%s — requireManager', (_name, file) => {
    checkPage(file, PAGE_MANAGER);
  });

  it.each(workerPages.map((f) => [rel(f), f]))('%s — requireWorker', (_name, file) => {
    checkPage(file, PAGE_WORKER);
  });

  it.each(Object.entries(OTHER_PAGES))('%s — развилка по роли, без прямых запросов к базе', (name, form) => {
    const file = path.join(APP, name);
    checkPage(file, [form]);
    expect(source(file)).not.toMatch(DB_CALL);
  });
});

const routes = files.filter((f) => path.basename(f) === 'route.ts');

/** Маршруты, где права проверяются иначе. Причина — обязательна. */
const ROUTE_EXCEPTIONS: Record<string, RegExp> = {
  // Личная ссылка: токен из адреса проверяется findWorkerByToken (security definer). GET ничего не меняет
  // (L6): уже вошёл этим работником — в приложение, иначе — подтверждение (w/[token]/confirm), вход — POST.
  'w/[token]/route.ts': /^const \{ token \} = await params; const worker = await findWorkerByToken\(token\); if \(!worker\) return noStoreRedirect\('\/login\?error=link'\); if \(await isSignedInAs\(worker\.id\)\) return noStoreRedirect\('\/shifts'\); return noStoreRedirect\(`\/w\/\$\{encodeURIComponent\(token\)\}\/confirm`\);$/,
  // Перенос cookie прежних версий (L6/L7): права — сами cookie этого браузера, роль не меняется и не расширяется.
  'auth/upgrade/route.ts': /^const result = await upgradeLegacyCookies\(\); if \(result === 'link-invalid'\) return noStoreRedirect\('\/login\?for=worker&error=link'\); return noStoreRedirect\(safeReturnPath\(/,
  // Подписка на календарь открывается приложением календаря без входа: права —
  // сам ключ из адреса, он проверяется функцией security definer до чтения данных.
  'cal/[token]/route.ts': /^const \{ token \} = await params; const workerId = await withAnon\(\(tx\) => feedWorkerId\(tx, token\)\); if \(!workerId\) return noStoreNotFound\(\);/,
  'cal/m/[token]/route.ts': /^const \{ token \} = await params; const valid = await withAnon\(\(tx\) => isManagerFeed\(tx, token\)\); if \(!valid\) return noStoreNotFound\(\);/,
  // Вебхук Telegram: права — секрет в заголовке, который знает только Telegram.
  'api/telegram/webhook/route.ts': /^if \(!isTelegramRequest\(request\)\) return new Response\(null, \{ status: 401 \}\);/,
  // Тик планировщика: права — секрет тика из app_secret (проверка — функцией security definer).
  'api/telegram/tick/route.ts': /^if \(!\(await isTickRequest\(request\)\)\) return new Response\(null, \{ status: 401 \}\);/,
};

describe('маршруты проверяют права сами, первым оператором', () => {
  it('маршруты найдены', () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it('выгрузка таблицы месяца — среди проверяемых маршрутов', () => {
    expect(routes.map(rel)).toContain('(manager)/month/[month]/export/route.ts');
  });

  it.each(routes.map((f) => [rel(f), f]))('%s', (name, file) => {
    const src = source(file);
    expect(hiddenExports(src, true), name).toEqual([]);
    const exported = functions(src).filter((f) => f.exported);
    const handlers = exported.filter((f) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(f.name));
    expect(handlers.length).toBeGreaterThan(0);
    // Другие экспортируемые функции Next в route.ts не принимает.
    expect(handlers).toHaveLength(exported.length);
    for (const handler of handlers) {
      const forms = name in ROUTE_EXCEPTIONS ? [ROUTE_EXCEPTIONS[name]] : ROUTE;
      expect(startsWithAny(handler.body, forms), `${name} ${handler.name}: первый оператор — не проверка прав`).toBe(true);
    }
  });
});

/**
 * POST-маршруты работают по cookie, а Route Handlers, в отличие от server actions, Next не сверяет
 * с Origin (L1 полного ревью безопасности). Поэтому сразу после проверки прав — isSameOrigin.
 * Вебхук Telegram и тик — по секрету в заголовке, не по cookie: им проверка не нужна.
 */
const ORIGIN_EXEMPT = new Set(['api/telegram/webhook/route.ts', 'api/telegram/tick/route.ts']);
const ORIGIN_CHECK = /^if \(!\(await isManager\(\)\)\) return [^;]*; if \(!isSameOrigin\(request\)\) return /;

describe('POST-маршруты сверяют Origin вторым оператором', () => {
  const posts = routes.filter((f) => functions(source(f)).some((fn) => fn.exported && fn.name === 'POST'));

  it('найдены маршруты загрузки файлов и Google', () => {
    expect(posts.map(rel).filter((r) => !ORIGIN_EXEMPT.has(r)).sort()).toEqual([
      'api/concerts/apply/route.ts', 'api/concerts/preview/route.ts',
      'api/import/apply/route.ts', 'api/import/google/route.ts', 'api/import/preview/route.ts',
      'api/schedule/apply/route.ts', 'api/schedule/preview/route.ts',
    ]);
  });

  it.each(posts.map((f) => [rel(f), f]).filter(([name]) => !ORIGIN_EXEMPT.has(name)))('%s', (_name, file) => {
    const post = functions(source(file)).find((fn) => fn.exported && fn.name === 'POST');
    expect(head(post?.body ?? '')).toMatch(ORIGIN_CHECK);
  });
});

const actionFiles = walk(path.resolve(__dirname, '../src'))
  .filter((f) => /\.tsx?$/.test(f))
  .filter((f) => /^\s*['"]use server['"]/.test(raw(f)));

/** Actions без проверки прав. Причина — обязательна. */
const ACTION_EXCEPTIONS: Record<string, string> = {
  // Вход: права здесь только появляются — после проверки пароля.
  'login/actions.ts#loginManager': 'вход по паролю',
  // Выход: удаляет только сессию с токеном из своей же cookie.
  'login/actions.ts#logoutManager': 'удаляет только свою сессию',
  // Вход из бота: права — одноразовый код из формы, его гасит security definer до установки cookie.
  'tg/actions.ts#confirmLoginAction': 'вход по одноразовому коду из бота',
  // Вход по личной ссылке после подтверждения: токен проверяет security definer до установки cookie.
  'tg/actions.ts#confirmPersonalLinkAction': 'вход по личной ссылке',
  // Вход из Telegram Mini App: права — initData, подписанные Telegram ключом бота (HMAC проверяется
  // до обращения к базе), повтор отсекает webapp_login (security definer).
  'tg/actions.ts#webAppLoginAction': 'вход из Mini App по подписи Telegram',
};

describe('каждый server action проверяет права сам', () => {
  it('файлы с actions найдены', () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(6);
  });

  it('применение шаблона вида — среди проверяемых actions', () => {
    const exported = (file: string) => functions(source(path.join(APP, file))).filter((f) => f.exported).map((f) => f.name);
    expect(exported('(manager)/event-types/actions.ts')).toEqual(
      expect.arrayContaining(['previewApplyTypeAction', 'applyTypeTemplateAction']));
    expect(exported('(manager)/event/[id]/actions.ts')).toContain('applyEventTemplateAction');
  });

  it('распределение по должностям — среди проверяемых actions', () => {
    const exported = (file: string) => functions(source(path.join(APP, file))).filter((f) => f.exported).map((f) => f.name);
    expect(exported('(manager)/event/[id]/actions.ts')).toEqual(
      expect.arrayContaining(['previewDistributeEventAction', 'applyDistributionAction']));
    expect(exported('(manager)/month/[month]/plan/actions.ts')).toContain('previewDistributeMonthAction');
  });

  it('inline "use server" не используется — иначе проверка ниже его не увидит', () => {
    const inline = files
      .filter((f) => /\.tsx?$/.test(f) && !actionFiles.includes(f))
      .filter((f) => /['"]use server['"]/.test(raw(f)))
      .map(rel);
    expect(inline).toEqual([]);
  });

  it.each(actionFiles.map((f) => [rel(f), f]))('%s', (name, file) => {
    const src = source(file);
    // Всё экспортируемое из 'use server' — объявления function (иначе их не найти ниже).
    expect(hiddenExports(src, false), name).toEqual([]);

    const fns = functions(src);
    // Локальные обёртки вроде run(): их первый оператор — проверка прав.
    const guards = fns.filter((f) => !f.exported && startsWithAny(f.body, ACTION)).map((f) => f.name);
    const viaGuard = guards.map((g) => new RegExp(`^return ${g}\\(`));

    const exported = fns.filter((f) => f.exported);
    expect(exported.length).toBeGreaterThan(0);
    for (const fn of exported) {
      if (`${name}#${fn.name}` in ACTION_EXCEPTIONS) continue;
      expect(startsWithAny(fn.body, [...ACTION, ...viaGuard]), `${name} ${fn.name}: первый оператор — не проверка прав`).toBe(true);
      // Аргументы run(…) вычисляются до проверки внутри run: база — только внутри стрелки.
      const text = head(fn.body);
      const db = text.search(DB_CALL);
      if (viaGuard.some((g) => g.test(text)) && db >= 0) {
        expect(text.slice(0, db), `${name} ${fn.name}: обращение к базе в аргументах run`).toContain('=>');
      }
    }
  });
});

describe('формы работают и до гидратации', () => {
  const clientFiles = walk(path.resolve(__dirname, '../src'))
    .filter((f) => /\.tsx$/.test(f) && /^\s*['"]use client['"]/.test(raw(f)));

  it('server action не связывается через .bind — id передаётся скрытым полем', () => {
    // Связанный action в useActionState при отправке без JS (до гидратации)
    // вешает next start (Next 16.3.6, 100% CPU) — см. final-fix-report.md.
    const bound = clientFiles.filter((f) => /\b\w+Action\.bind\s*\(/.test(source(f))).map(rel);
    expect(bound).toEqual([]);
  });

  it('форма с onSubmit={submitKeepingValues(…)} несёт и action={…} — иначе до гидратации уйдёт GET', () => {
    const missing = clientFiles.flatMap((f) =>
      (source(f).match(/<form\b[^>]*>/g) ?? [])
        .filter((tag) => tag.includes('submitKeepingValues(') && !/\baction=\{/.test(tag))
        .map((tag) => `${rel(f)}: ${tag}`));
    expect(missing).toEqual([]);
  });
});
