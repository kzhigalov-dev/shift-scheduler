// Проверка вёрстки: каждый экран на нескольких ширинах в светлой и тёмной теме.
// Только локально: база — локальный Supabase, приложение — локальная сборка.
// Сеет временные данные (работники, события, назначения, сессия менеджера)
// и удаляет их в конце. Токены входа генерируются здесь и не печатаются.
// Хеши токенов до вставки записываются в .superpowers/layout/.pending, чтобы
// прерванный (в т.ч. SIGKILL) прогон убрал за собой при следующем запуске.
// Коды выхода: 0 — всё ровно, 1 — нарушения или ошибка, 2 — неверные аргументы.
import { chromium } from 'playwright';
import postgres from 'postgres';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';

process.loadEnvFile('.env.local');

const BASE = process.env.LAYOUT_BASE_URL ?? 'http://localhost:3100';
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
// --width=N — все выбранные экраны на одной ширине N (разовая проверка чужих ширин).
// Экран со своим списком widths (состояние есть только на этих ширинах) на другой ширине пропускается.
// Только с «=»: «--width» и «--width N» иначе молча прогнали бы стандартные ширины.
if (process.argv.some((a) => a.startsWith('--width') && !a.startsWith('--width='))) {
  console.error('--width: нужна форма --width=N');
  process.exit(2);
}
const widthArg = process.argv.find((a) => a.startsWith('--width='))?.slice(8);
const forcedWidth = widthArg === undefined ? null : Number(widthArg);
if (forcedWidth !== null && !(Number.isInteger(forcedWidth) && forcedWidth >= 280 && forcedWidth <= 2560)) {
  console.error(`--width=${widthArg}: нужна целая ширина от 280 до 2560`);
  process.exit(2);
}

const dbUrl = new URL(process.env.DATABASE_URL);
dbUrl.username = 'postgres';
dbUrl.password = 'postgres';
for (const u of [dbUrl, new URL(BASE)]) {
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) {
    throw new Error(`layout-check только для локальной среды, получено: ${u.hostname}`);
  }
}
// Локальный Supabase слушает 54322; другой порт — только явным разрешением.
const allowedDbPort = process.env.LAYOUT_ALLOW_DB_PORT ?? '54322';
if (dbUrl.port !== allowedDbPort) {
  throw new Error(`layout-check: порт базы ${dbUrl.port || '(по умолчанию)'} не ${allowedDbPort}; `
    + 'для другого порта задайте LAYOUT_ALLOW_DB_PORT');
}

const archivedFixtureDb = dbUrl.pathname.endsWith('_layout');
const sql = postgres(dbUrl.toString(), { max: 1, onnotice: () => {} });
const hash = (t) => createHash('sha256').update(t).digest('hex');
const PREFIX = 'Проверка вёрстки';
const OUT = '.superpowers/layout';
const PENDING = `${OUT}/.pending`;
mkdirSync(OUT, { recursive: true });

const MANAGER_WIDTHS = [375, 1024, 1280, 1440];
const WORKER_WIDTHS = [320, 375, 390, 1280, 1440];
const THEMES = ['light', 'dark'];

const managerToken = randomBytes(32).toString('base64url');
const workerToken = randomBytes(32).toString('base64url');
// Сессия засеянного работника (как после «Войти» по личной ссылке, 0015): в cookie — она, не токен ссылки.
const workerSessionToken = randomBytes(32).toString('base64url');
// Проверка идёт на production-сборке (`next start`): cookie входа — с префиксом __Host- (L7), Secure;
// Chromium принимает Secure-cookie и на http://localhost.
const COOKIE = { manager: '__Host-manager_session', worker: '__Host-worker_session' };
// Код входа из бота для экранов подтверждения (`loginCode: true`); GET его не гасит.
const loginCode = randomBytes(32).toString('base64url');
const KEY_PREFIX = 'проверка вёрстки';
const WORKER_KEY = `${KEY_PREFIX} работник`;

// Экраны. path — функция от засеянных данных. steps(page, s) — необязательный
// хук: выполняется после загрузки, перед проверкой (открыть диалог, раскрыть
// список и т. п.); экран с хуком проверяется в том состоянии, в которое его привёл хук.
// Хуки ничего не подтверждают и не отправляют: деструктивные кнопки диалогов не нажимаются.
// widths — необязательный список ширин вместо стандартного набора роли: состояние есть только на них
// (с --width=N на другой ширине экран пропускается). extraWidths — ширины сверх стандартного набора
// роли; такой экран с --width=N проверяется на N, как обычный.
const SCREENS = [
  { name: 'm-import-unconfigured', path: () => '/import', role: 'manager',
    when: () => !process.env.NEXT_PUBLIC_GOOGLE_STAFF_SHEET_ID,
    steps: async page => {
      await page.getByText('Импорт Google не настроен. Загрузите файл .xlsx.').waitFor();
      if (await page.getByRole('button', {name:'Из Google',exact:true}).count()) throw new Error('Google без настройки');
    },
  },
  { name: 'login', path: () => '/login', role: null },
  { name: 'login-worker', path: () => '/login?for=worker', role: null, widths: [320, 375, 768, 1280, 1440] },
  {
    name: 'login-worker-manager-form', path: () => '/login?for=worker', role: null,
    widths: [320, 375, 768, 1280, 1440],
    steps: async page => { await page.getByText('Я менеджер', { exact: true }).click(); await page.getByLabel('Пароль').waitFor(); },
  },
  { name: 'login-worker-tg-expired', path: () => '/login?error=tg', role: null, widths: [320, 375, 768, 1280, 1440] },
  { name: 'login-worker-link-expired', path: () => '/login?for=worker&error=link', role: null, widths: [320, 375, 768, 1280, 1440] },
  { name: 'login-worker-tg-used', path: () => '/login?error=tg-used', role: null, widths: [320, 375, 768, 1280, 1440] },
  // Подтверждение входа по ссылке из бота: GET только показывает «Войти как …?» (код засеян, `loginCode`;
  // он действует только при привязке чата — `linked`); «Войти» не нажимается.
  {
    name: 'tg-login-confirm', path: () => `/tg/${loginCode}?to=/available`, role: null, linked: true, loginCode: true,
    widths: [320, 375, 768, 1280, 1440],
    steps: async (page) => { await page.getByRole('button', { name: 'Войти' }).waitFor(); },
  },
  {
    name: 'tg-login-confirm-manager', path: () => `/tg/${loginCode}`, role: 'manager', linked: true, loginCode: true,
    widths: [320, 375, 1280],
    steps: async (page) => { await page.getByText('Вход менеджера в этом браузере закроется.').waitFor(); },
  },
  // Личная ссылка без роли в браузере: GET ничего не меняет — «Войти как …?» (L6); «Войти» не нажимается.
  {
    name: 'w-link-open', path: () => `/w/${workerToken}`, role: null, widths: [320, 375, 1280],
    steps: async (page) => {
      await page.getByRole('button', { name: 'Войти' }).waitFor();
      if (!page.url().endsWith('/confirm')) throw new Error(`ожидалось подтверждение, открыто ${page.url()}`);
    },
  },
  // Старая cookie личной ссылки (worker_token, до 0015): прокси переносит её на сессию и возвращает на страницу.
  {
    name: 'w-legacy-cookie', path: () => '/shifts', role: 'worker-legacy', widths: [375],
    steps: async (page) => {
      const names = (await page.context().cookies()).map((c) => c.name);
      if (names.includes('worker_token') || !names.includes(COOKIE.worker)) throw new Error(`cookie не перенесены: ${names.join(', ')}`);
      if (!page.url().endsWith('/shifts')) throw new Error(`после переноса открыто ${page.url()}`);
    },
  },
  // Личная ссылка при другой роли в браузере — то же подтверждение.
  {
    name: 'w-link-confirm', path: () => `/w/${workerToken}/confirm`, role: 'manager', widths: [320, 375, 1280],
    steps: async (page) => { await page.getByRole('button', { name: 'Войти' }).waitFor(); },
  },
  // Mini App вне Telegram (нет initData) и с initData, которые не прошли проверку (локально ключа бота нет —
  // «не настроен»; с ключом — неверная подпись). Состояние «Входим…» длится до ответа сервера — не снимается.
  {
    name: 'tg-app-outside', path: () => '/tg/app', role: null, widths: [320, 375, 768, 1280, 1440],
    steps: async (page) => { await page.getByRole('heading', { name: 'Откройте эту кнопку в Telegram' }).waitFor(); },
  },
  {
    name: 'tg-app-error', role: null, widths: [320, 375, 768, 1280, 1440],
    path: () => `/tg/app?to=/available#tgWebAppData=${encodeURIComponent(`query_id=layout&auth_date=1&hash=${'0'.repeat(64)}`)}`,
    steps: async (page) => { await page.getByRole('heading', { name: 'Не получилось войти' }).waitFor(); },
  },
  {
    name: 'login-worker-as-manager', path: () => '/login?for=worker', role: 'manager', allowLogin: true,
    widths: [320, 375, 768, 1280, 1440],
    steps: async page => { await page.getByRole('link', { name: 'Перейти в «Месяц»' }).waitFor(); },
  },
  { name: 'm-month', path: () => '/month?month=2026-07', role: 'manager' },
  { name: 'm-month-seed', path: (s) => `/month?month=${s.seedMonth}`, role: 'manager' },
  // «Сводка месяца»: от 1440 — колонка справа, уже — строка над календарём (заполненность, ждут решения,
  // нехватка на 3 дня — засеянные мероприятия текущей недели, статус). Черновик — с «Опубликовать» (не нажимается).
  {
    name: 'm-month-summary', path: (s) => `/month?month=${s.seedMonth}`, role: 'manager', widths: [375, 1280, 1440],
    steps: async (page) => {
      await page.getByRole('progressbar', { name: 'Заполнено мест' }).filter({ visible: true }).first().waitFor();
    },
  },
  {
    name: 'm-month-summary-draft', path: () => `/month?month=${DRAFT_MONTH}`, role: 'manager', widths: [375, 1280, 1440],
    steps: async (page) => {
      await page.getByRole('button', { name: 'Опубликовать' }).filter({ visible: true }).first().waitFor();
    },
  },
  { name: 'm-event', path: (s) => `/event/${s.julyEvent}`, role: 'manager' },
  { name: 'm-event-seed', path: (s) => `/event/${s.seedEvent}`, role: 'manager' },
  {
    name: 'm-event-rate-dialog', path: (s) => `/event/${s.seedEvent}`, role: 'manager',
    steps: async page => {
      await page.getByRole('button',{name:'Меню должности ЗАЛ',exact:true}).click();
      await page.getByRole('menuitem',{name:'Настройки должности',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Настройки должности',exact:true});
      await dialog.getByText('Пусто — ставка вида:',{exact:false}).waitFor();
      if (!/2\s000/.test(await dialog.innerText())) throw new Error('Не показана ставка вида ЗАЛ');
    },
  },
  {
    name: 'm-event-rate-custom-dialog', path: (s) => `/event/${s.seedEvent}`, role: 'manager',
    steps: async page => {
      await page.getByRole('button',{name:'Меню должности БИЛЕТЫ',exact:true}).click();
      await page.getByRole('menuitem',{name:'Настройки должности',exact:true}).click();
      const input=page.getByRole('dialog',{name:'Настройки должности',exact:true}).getByLabel('Ставка на этом мероприятии, ₽');
      if (await input.inputValue() !== '2600') throw new Error('Не показана отдельная ставка мероприятия');
    },
  },
  { name: 'm-workers', path: () => '/workers', role: 'manager' },
  { name: 'm-workers-archive', path: () => '/workers?tab=archived', role: 'manager' },
  // Окно «Перевыпустить ссылку?» у засеянного работника со ссылкой; «Перевыпустить» не нажимается.
  {
    name: 'm-workers-reissue-dialog', path: () => '/workers', role: 'manager',
    steps: async (page) => {
      await page.getByRole('button', { name: 'Действия: Константин Константинопольский-Преображенский' }).first().click();
      await page.getByRole('menuitem', { name: 'Перевыпустить ссылку' }).click();
      await page.getByRole('dialog', { name: 'Перевыпустить ссылку?' })
        .and(page.locator('[data-slot="dialog-content"]')).waitFor();
    },
  },
  { name: 'm-types', path: () => '/event-types', role: 'manager', extraWidths: [768] },
  { name: 'm-types-archive', path: () => '/event-types?tab=archived', role: 'manager' },
  {
    name: 'm-types-new-dialog', path: () => '/event-types', role: 'manager',
    steps: async page => {
      await page.getByRole('button',{name:'Добавить вид',exact:true}).click();
      await page.getByRole('dialog',{name:'Новый вид мероприятия'}).waitFor();
    },
  },
  {
    name: 'm-types-edit-dialog', path: () => '/event-types', role: 'manager',
    steps: async page => {
      await page.getByRole('button',{name:`Изменить вид: ${TYPE_NAME}`}).first().click();
      await page.getByRole('dialog',{name:'Изменить вид',exact:true}).waitFor();
      if (await page.getByLabel('Ставка вида: ЗАЛ',{exact:true}).inputValue() !== '2000') throw new Error('Не показана ставка вида');
    },
  },
  {
    name: 'm-types-archive-dialog', path: () => '/event-types', role: 'manager',
    steps: async page => {
      await page.getByRole('button',{name:`В архив: ${TYPE_NAME}`}).first().click();
      await page.getByRole('dialog',{name:'Убрать вид в архив?'}).waitFor();
    },
  },
  {
    name: 'm-types-error', path: () => '/event-types', role: 'manager',
    steps: async page => {
      await page.getByRole('button',{name:'Добавить вид',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Новый вид мероприятия'});
      // Некорректное имя гарантирует отсутствие записи; отключаем только HTML validation.
      await dialog.locator('form').evaluate(form=>{form.noValidate=true});
      await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
      await dialog.getByRole('alert').waitFor();
    },
  },
  {
    name: 'm-types-rate-error', path: () => '/event-types', role: 'manager',
    steps: async page => {
      await page.getByRole('button',{name:'Добавить вид',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Новый вид мероприятия'});
      await dialog.getByLabel('Название',{exact:true}).fill(`${PREFIX} · Некорректная ставка`);
      await dialog.getByLabel('Ставка вида: ЗАЛ',{exact:true}).fill('-1');
      await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
      await dialog.getByRole('alert').waitFor();
    },
  },
  // Окно «Применить к мероприятиям» с изменениями (список прокручивается); «Применить» не нажимается.
  {
    name: 'm-types-apply-dialog', path: () => '/event-types', role: 'manager',
    steps: async page => {
      await page.getByRole('button',{name:`Применить к мероприятиям: ${APPLY_TYPE_NAME}`}).first().click();
      await page.getByRole('dialog',{name:`Применить состав «${APPLY_TYPE_NAME}»?`})
        .getByRole('button',{name:/^Применить к\s\d+$/}).waitFor();
    },
  },
  // То же окно, когда все будущие мероприятия вида уже по шаблону: только «Закрыть».
  {
    name: 'm-types-apply-none', path: () => '/event-types', role: 'manager',
    steps: async page => {
      await page.getByRole('button',{name:`Применить к мероприятиям: ${SAME_TYPE_NAME}`}).first().click();
      await page.getByRole('dialog',{name:`Применить состав «${SAME_TYPE_NAME}»?`})
        .getByText('Все будущие мероприятия уже соответствуют шаблону.').waitFor();
    },
  },
  // Строка «Состав отличается от шаблона» над составом засеянного мероприятия; «Применить шаблон» не нажимается.
  {
    name: 'm-event-template', path: (s) => `/event/${s.applyEvent}`, role: 'manager',
    steps: async page => { await page.getByRole('button',{name:'Применить шаблон',exact:true}).waitFor(); },
  },
  // Распределение по должностям на мероприятии (три человека без должности); «Применить» не нажимается.
  {
    name: 'm-event-distribute', path: (s) => `/event/${s.distributeEvent}`, role: 'manager', widths: [375, 1280],
    steps: async (page) => { await openDistribute(page); },
  },
  // То же окно: БАЛКОН (одно место) выбран двоим — строки подсвечены, подпись, «Применить» недоступна.
  {
    name: 'm-event-distribute-over', path: (s) => `/event/${s.distributeEvent}`, role: 'manager', widths: [375, 1280],
    steps: async (page) => {
      const dialog = await openDistribute(page);
      for (const i of [0, 1]) {
        await dialog.getByRole('combobox').nth(i).click();
        await page.getByRole('option', { name: /^БАЛКОН/ }).click();
      }
      await dialog.getByText('На БАЛКОН мест: 1').waitFor();
      if (await dialog.getByRole('button', { name: 'Применить', exact: true }).isEnabled()) throw new Error('«Применить» доступна при превышении');
    },
  },
  { name: 'm-event-edit-archived', path:s=>`/event/${s.seedEvent}`,role:'manager',allTypesArchived:true,
    steps:async page=>{await page.getByRole('button',{name:'Изменить',exact:true}).click();
      await page.getByRole('dialog',{name:'Изменить событие'}).waitFor()} },
  { name: 'm-event-type-options', path:s=>`/event/${s.seedEvent}`,role:'manager',
    steps:async page=>{await page.getByRole('button',{name:'Изменить',exact:true}).click();
      await page.getByRole('dialog',{name:'Изменить событие'}).getByRole('combobox').click();
      await page.getByRole('listbox').waitFor()} },
  { name: 'm-types-empty', path: () => '/event-types', role: 'manager', allTypesArchived: true },
  {
    name: 'm-new-event-empty-types', path:s=>`/month?month=${s.seedMonth}`, role:'manager', allTypesArchived:true,
    steps:async page=>{await page.getByRole('button',{name:'Событие',exact:true}).first().click();
      await page.getByRole('dialog',{name:'Новое событие'}).waitFor()},
  },
  {
    name: 'm-new-event-dialog', path:s=>`/month?month=${s.seedMonth}`, role:'manager',
    steps:async page=>{await page.getByRole('button',{name:'Событие',exact:true}).first().click();
      await page.getByRole('dialog',{name:'Новое событие'}).waitFor()},
  },
  {
    name: 'm-event-edit-dialog', path:s=>`/event/${s.seedEvent}`, role:'manager',
    steps:async page=>{await page.getByRole('button',{name:'Изменить',exact:true}).click();
      await page.getByRole('dialog',{name:'Изменить событие'}).waitFor()},
  },
  {
    name: 'm-plan-add-dialog', path:()=>`/month/${DRAFT_MONTH}/plan`, role:'manager',
    steps:async page=>{await page.getByRole('button',{name:'Мероприятие',exact:true}).filter({visible:true}).first().click();
      await page.getByRole('dialog',{name:'Новое мероприятие'}).waitFor()},
  },
  { name: 'm-positions', path: () => '/positions', role: 'manager' },
  { name: 'm-pay', path: () => '/pay?month=2026-07', role: 'manager' },
  { name: 'm-import', path: () => '/import', role: 'manager' },
  {
    name: 'm-import-google', path: () => '/import', role: 'manager',
    steps: async page => { await page.getByRole('button', {name:'Из Google',exact:true}).click(); },
  },

  {
    name: 'm-import-google-preview', path: () => '/import', role: 'manager',
    steps: async page => {
      await page.route('**/api/import/google', route => route.fulfill({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:readFileSync(IMPORT_FIXTURE)}));
      await page.getByRole('button',{name:'Из Google',exact:true}).click();
      await page.getByRole('button',{name:'Загрузить таблицу',exact:true}).click();
      await page.getByRole('table').waitFor();
    },
  },
  {
    name: 'm-import-google-error', path: () => '/import', role: 'manager',
    steps: async page => {
      await page.route('**/api/import/google', route => route.fulfill({status:403,json:{error:'Нет доступа к таблице Google. Проверьте доступ на просмотр или загрузите файл .xlsx.'}}));
      await page.getByRole('button',{name:'Из Google',exact:true}).click();
      await page.getByRole('button',{name:'Загрузить таблицу',exact:true}).click();
      await page.getByRole('alert').first().waitFor();
    },
  },

  {
    name: 'm-import-google-reviewed', path: () => '/import', role: 'manager',
    steps: async page => {
      await page.route('**/api/import/google', route => route.fulfill({status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:readFileSync('tests/fixtures/google-staff.xlsx')}));
      await page.getByRole('button',{name:'Из Google',exact:true}).click();
      await page.getByRole('button',{name:'Загрузить таблицу',exact:true}).click();
      await page.getByRole('table').waitFor();
      await page.getByRole('checkbox',{name:'Импортировать лист Декабрь 2098',exact:true}).click();
      await page.getByRole('button',{name:'Проверить выбранные листы',exact:true}).click();
      await page.getByText('Возможные переносы',{exact:true}).waitFor();
      if (!await page.getByRole('button',{name:'Импортировать',exact:true}).isDisabled()) throw new Error('возможный перенос не требует выбора');
    },
  },
  { name: 'm-concert-import', path: () => `/import/concerts?month=${DRAFT_MONTH}`, role: 'manager' },
  {
    name: 'm-concert-import-google', path: () => `/import/concerts?month=${DRAFT_MONTH}`, role: 'manager',
    steps: async page => { await page.getByRole('button', {name:'Из Google',exact:true}).click(); },
  },
  {
    name: 'm-concert-import-preview', path: () => `/import/concerts?month=${DRAFT_MONTH}`, role: 'manager',
    steps: async page => {
      await page.setInputFiles('input[type="file"]', 'tests/fixtures/concerts.xlsx');
      await page.getByRole('heading',{name:'Сверка концертов'}).waitFor();
    },
  },
  {
    name: 'm-concert-import-details', path: () => `/import/concerts?month=${DRAFT_MONTH}`, role: 'manager',
    steps: async page => {
      await page.setInputFiles('input[type="file"]', 'tests/fixtures/concerts.xlsx');
      await page.getByRole('heading',{name:'Сверка концертов'}).waitFor();
      await page.locator('details > summary').first().click();
    },
  },
  {
    name: 'm-month-google', path: () => `/month/new?month=${NEW_MONTH}`, role: 'manager',
    steps: async page => { await page.getByRole('button', {name:'Из Google',exact:true}).click(); },
  },
  {
    name: 'm-event-program', path: s => `/event/${s.seedEvent}`, role: 'manager',
    steps: async page => { await page.getByText('Программа концерта',{exact:true}).click(); },
  },
  { name: 'm-instructions', path: () => '/instructions', role: 'manager' },
  // Уведомления. Без привязки (`linked` не задан) страница показывает «не настроен» при запуске без
  // TELEGRAM_BOT_TOKEN (так запускается проверка) или «Подключить Telegram» с ключом. `linked: true` —
  // перед экраном в базу вставляется привязка чата (chat_id -2 у менеджера, -1 у работника: реальным
  // чатом id быть не могут, бот не вызывается), после экрана она удаляется: настройки видны и без ключа.
  { name: 'm-telegram', path: () => '/telegram', role: 'manager' },
  { name: 'm-telegram-connected', path: () => '/telegram', role: 'manager', linked: true },
  // Окно «Отключить Telegram»; «Отключить» не нажимается.
  {
    name: 'm-telegram-disconnect-dialog', path: () => '/telegram', role: 'manager', linked: true,
    steps: async (page) => {
      await page.getByRole('button', { name: 'Отключить Telegram' }).click();
      await page.getByRole('dialog', { name: 'Отключить Telegram?' })
        .and(page.locator('[data-slot="dialog-content"]')).waitFor();
    },
  },
  // Диалог удаления события на засеянном событии; «Удалить» не нажимается.
  {
    name: 'm-event-delete-dialog', path: (s) => `/event/${s.seedEvent}`, role: 'manager',
    steps: async (page) => {
      await page.getByRole('button', { name: 'Действия с событием' }).click();
      await page.getByRole('menuitem', { name: 'Удалить событие' }).click();
      await page.getByRole('dialog', { name: 'Удалить событие?' }).waitFor();
    },
  },
  // Меню менеджера в шторке (видно только ниже 1024 px): проверяем на 768.
  {
    name: 'm-menu-sheet', path: () => '/positions', role: 'manager', widths: [768],
    steps: async (page) => {
      await page.getByRole('button', { name: 'Открыть меню' }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  // Раскрытая детализация «По сменам».
  {
    name: 'm-pay-details', path: () => '/pay?month=2026-07', role: 'manager',
    steps: async (page) => {
      await page.locator('details > summary', { hasText: 'По сменам' }).click();
      await page.locator('details[open] table').waitFor();
    },
  },
  // Шаг 2 импорта: файл загружен на проверку, замечания листов раскрыты. Импорт не запускается.
  {
    name: 'm-import-step2', path: () => '/import', role: 'manager',
    steps: async (page) => {
      await page.setInputFiles('input[type="file"]', IMPORT_FIXTURE);
      await page.getByRole('table').waitFor();
      for (const b of await page.locator('button[aria-label^="Замечания"]').all()) await b.click();
    },
  },
  { name: 'm-month-new', path: () => `/month/new?month=${NEW_MONTH}`, role: 'manager' },
  // Шаг «Мероприятия»: файл загружен, ничего не создаётся.
  {
    name: 'm-month-new-rows', path: () => `/month/new?month=${NEW_MONTH}`, role: 'manager',
    steps: async (page) => {
      await page.setInputFiles('input[type="file"]', SCHEDULE_FIXTURE);
      await page.getByRole('table').waitFor();
    },
  },
  // Тот же шаг, но файл брошен в зону перетаскиванием (настоящие dragenter/dragover/drop с DataTransfer):
  // зона подсвечивается, после броска фокус — на «Убрать файл», таблица строк появляется.
  {
    name: 'm-month-new-drop', path: () => `/month/new?month=${NEW_MONTH}`, role: 'manager',
    steps: async (page) => {
      const bytes = readFileSync(SCHEDULE_FIXTURE).toString('base64');
      const dataTransfer = await page.evaluateHandle((b64) => {
        const dt = new DataTransfer();
        const data = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        dt.items.add(new File([data], 'schedule.xlsx',
          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        return dt;
      }, bytes);
      const zone = page.locator('button[data-dropzone]');
      await zone.dispatchEvent('dragenter', { dataTransfer });
      await zone.dispatchEvent('dragover', { dataTransfer });
      await page.waitForFunction(() => document.querySelector('[data-dropzone]')?.classList.contains('border-primary'));
      await zone.dispatchEvent('drop', { dataTransfer });
      await page.getByRole('table').waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Убрать файл');
    },
  },
  // «Убрать файл» после загрузки: снова пустая зона, фокус — на ней.
  {
    name: 'm-month-new-cleared', path: () => `/month/new?month=${NEW_MONTH}`, role: 'manager',
    steps: async (page) => {
      await page.setInputFiles('input[type="file"]', SCHEDULE_FIXTURE);
      await page.getByRole('table').waitFor();
      await page.getByRole('button', { name: 'Убрать файл' }).click();
      await page.waitForFunction(() => document.activeElement?.matches('button[data-dropzone]'));
    },
  },
  // Лист месяца есть, но в нём только даты и другая площадка («янв 99»): ошибка под полем файла.
  {
    name: 'm-month-new-empty-error', path: () => `/month/new?month=${EMPTY_SHEET_MONTH}`, role: 'manager',
    steps: async (page) => {
      await page.setInputFiles('input[type="file"]', SCHEDULE_FIXTURE);
      await page.getByRole('alert').filter({ hasText: 'мероприятий Анненкирхе в нём пока нет' }).waitFor();
    },
  },
  // Повторная загрузка в засеянный черновик: новые, изменённые, пропавшие. «Применить» не нажимается.
  // «Лунный свет» засеян на 19:00, в листе «дек 98» — 20:00: попадает в «Изменились».
  {
    name: 'm-month-reimport', path: () => `/month/new?month=${DRAFT_MONTH}`, role: 'manager',
    steps: async (page) => {
      await page.setInputFiles('input[type="file"]', SCHEDULE_FIXTURE);
      await page.getByText(/^Нет в расписании/).waitFor();
    },
  },
  // 768 — граница «карточки / таблица»: на ней уже таблица.
  { name: 'm-plan', path: () => `/month/${DRAFT_MONTH}/plan`, role: 'manager', extraWidths: [768] },
  // Открытая ячейка с подсказками; ничего не выбирается. Таблица — от 768 px, уже — карточки.
  {
    name: 'm-plan-cell', path: () => `/month/${DRAFT_MONTH}/plan`, role: 'manager', widths: [1024, 1280, 1440],
    steps: async (page) => {
      await page.getByRole('button', { name: 'Пустая ячейка — вписать человека' }).first().click();
      await page.getByRole('listbox', { name: 'Подсказки' }).waitFor();
    },
  },
  // Диалог публикации; «Опубликовать» в диалоге не нажимается.
  {
    name: 'm-plan-publish-dialog', path: () => `/month/${DRAFT_MONTH}/plan`, role: 'manager',
    steps: async (page) => {
      await page.getByRole('button', { name: 'Опубликовать' }).click();
      await page.getByRole('dialog', { name: 'Опубликовать месяц?' }).waitFor();
    },
  },
  // Шторка места на телефоне: первое «Вписать» в карточке; ничего не выбирается.
  {
    name: 'm-plan-place-sheet', path: () => `/month/${DRAFT_MONTH}/plan`, role: 'manager', widths: [375],
    steps: async (page) => {
      await page.getByRole('button', { name: /вписать человека/ }).first().click();
      await page.locator('[data-slot="sheet-content"]').getByRole('listbox', { name: 'Подсказки' }).waitFor();
    },
  },
  // Шторка занятого места (засеянный работник в «Лунном свете»): внизу «Очистить» — не нажимается.
  {
    name: 'm-plan-place-sheet-filled', path: () => `/month/${DRAFT_MONTH}/plan`, role: 'manager', widths: [375],
    steps: async (page) => {
      await page.getByRole('button', { name: /— изменить/ }).first().click();
      const sheet = page.locator('[data-slot="sheet-content"]');
      await sheet.getByRole('listbox', { name: 'Подсказки' }).waitFor();
      await sheet.getByRole('button', { name: 'Очистить' }).waitFor();
    },
  },
  // Правка «Ставки» в карточке: маленький диалог с одним полем; «Сохранить» не нажимается.
  {
    name: 'm-plan-field-dialog', path: () => `/month/${DRAFT_MONTH}/plan`, role: 'manager', widths: [375],
    steps: async (page) => {
      await page.getByRole('button', { name: /^Ставка/ }).click();
      await page.getByRole('dialog', { name: /^Ставка,/ }).and(page.locator('[data-slot="dialog-content"]')).waitFor();
    },
  },
  // «Смены в месяце» в шторке (уже 1280 px).
  {
    name: 'm-plan-counts-sheet', path: () => `/month/${DRAFT_MONTH}/plan`, role: 'manager', widths: [375, 1024],
    steps: async (page) => {
      await page.getByRole('button', { name: 'Смены в месяце' }).click();
      await page.getByRole('dialog', { name: 'Смены в месяце' }).and(page.locator('[data-slot="sheet-content"]')).waitFor();
    },
  },
  // Меню «Ещё» таблицы ниже md: «Загрузить расписание снова» и «Скачать» (файл не скачивается).
  {
    name: 'm-plan-more', path: () => `/month/${DRAFT_MONTH}/plan`, role: 'manager', widths: [375],
    steps: async (page) => {
      await page.getByRole('button', { name: 'Ещё' }).click();
      await page.getByRole('menuitem', { name: 'Скачать', exact: true }).waitFor();
    },
  },
  // Распределение на месяц (черновик APPLY_MONTH, люди без должности на трёх мероприятиях): от 1280 — кнопка шапки,
  // уже — пункт «⋯». «Применить» не нажимается.
  {
    name: 'm-plan-distribute', path: () => `/month/${APPLY_MONTH}/plan`, role: 'manager', widths: [375, 1280],
    steps: async (page) => {
      const dialog = await openMonthDistribute(page);
      await dialog.getByRole('button', { name: /^Применить к\s\d+$/ }).waitFor();
    },
  },
  // То же окно, когда распределять некого (DRAFT_MONTH): только «Закрыть».
  {
    name: 'm-plan-distribute-empty', path: () => `/month/${DRAFT_MONTH}/plan`, role: 'manager', widths: [375, 1280],
    steps: async (page) => {
      const dialog = await openMonthDistribute(page);
      await dialog.getByText(/^Распределять некого/).waitFor();
    },
  },
  // Меню «Ещё» месяца: ниже sm — ссылки шапки, на всех ширинах — «Скачать таблицу» (файл не скачивается).
  {
    name: 'm-month-more', path: (s) => `/month?month=${s.seedMonth}`, role: 'manager',
    steps: async (page) => {
      await page.getByRole('button', { name: 'Ещё' }).click();
      await page.getByRole('menuitem', { name: 'Скачать таблицу', exact: true }).waitFor();
    },
  },
  // Окно подписки менеджера; «Подключить» не нажимается.
  {
    name: 'm-calendar-dialog', path: () => '/month?month=2026-07', role: 'manager',
    steps: async (page) => {
      await page.getByRole('button', { name: 'Календарь' }).click();
      await page.getByRole('dialog', { name: 'Мероприятия в моём календаре' })
        .and(page.locator('[data-slot="dialog-content"]')).waitFor();
    },
  },
  // 1536 (2xl) — карточки в три колонки.
  { name: 'w-shifts', path: () => '/shifts', role: 'worker', extraWidths: [1536] },
  // «Ближайшая смена» над списком, показатели месяца и (от 1280) колонка свободных мест недели.
  {
    name: 'w-next-shift', path: () => '/shifts', role: 'worker',
    steps: async (page) => { await page.getByRole('heading', { name: 'Ближайшая смена' }).waitFor(); },
  },
  // Окно подписки работника; «Подключить» не нажимается.
  {
    name: 'w-calendar-dialog', path: () => '/shifts', role: 'worker',
    steps: async (page) => {
      await page.getByRole('button', { name: 'Смены в моём календаре' }).click();
      await page.getByRole('dialog', { name: 'Смены в моём календаре' })
        .and(page.locator('[data-slot="dialog-content"]')).waitFor();
    },
  },
  { name: 'w-month', path: (s) => `/shifts?view=month&month=${s.seedMonth}`, role: 'worker', extraWidths: [1536] },
  { name: 'w-available', path: () => '/available', role: 'worker', extraWidths: [1536] },
  // Шторка «Не смогу» на засеянной смене работника; «Отправить запрос» не нажимается.
  // На мониторе вместо шторки диалог — отдельный экран ниже.
  {
    name: 'w-shift-cancel-sheet', path: () => '/shifts', role: 'worker', widths: [320, 375, 390],
    steps: async (page) => {
      await page.getByRole('button', { name: 'Не смогу' }).first().click();
      await page.getByRole('dialog', { name: 'Не сможете выйти?' })
        .and(page.locator('[data-slot="sheet-content"]')).waitFor();
    },
  },
  // Диалог «Не смогу» на мониторе; «Отправить запрос» не нажимается.
  {
    name: 'w-shift-cancel-dialog', path: () => '/shifts', role: 'worker', widths: [1280],
    steps: async (page) => {
      await page.getByRole('button', { name: 'Не смогу' }).first().click();
      // Именно диалог: шторка (до lg) тоже role="dialog" с тем же именем.
      await page.getByRole('dialog', { name: 'Не сможете выйти?' })
        .and(page.locator('[data-slot="dialog-content"]')).waitFor();
    },
  },
  { name: 'w-earnings', path: (s) => `/earnings?month=${s.pastMonth}`, role: 'worker' },
  // Столбики заработка за полгода; выбранный месяц — текущий (засеянные смены этого месяца).
  {
    name: 'w-earnings-chart', path: (s) => `/earnings?month=${s.seedMonth}`, role: 'worker',
    steps: async (page) => { await page.locator('a[aria-current="page"][href^="/earnings?month="]').waitFor(); },
  },
  { name: 'w-instructions', path: () => '/instructions', role: 'worker' },
  // Уведомления: `linked` — см. m-telegram.
  { name: 'w-notifications', path: () => '/notifications', role: 'worker' },
  { name: 'w-notifications-connected', path: () => '/notifications', role: 'worker', linked: true },
  {
    name: 'w-notifications-disconnect-dialog', path: () => '/notifications', role: 'worker', linked: true,
    steps: async (page) => {
      await page.getByRole('button', { name: 'Отключить Telegram' }).click();
      await page.getByRole('dialog', { name: 'Отключить Telegram?' })
        .and(page.locator('[data-slot="dialog-content"]')).waitFor();
    },
  },
];
// Окно «Распределить по должностям»: на мероприятии — кнопка в «Без должности»; ждём выбор должности.
async function openDistribute(page) {
  await page.getByRole('button', { name: 'Распределить по должностям', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Распределить по должностям' });
  await dialog.getByRole('combobox').first().waitFor();
  return dialog;
}
// На таблице месяца — кнопка шапки, если видна, иначе пункт меню «Ещё».
async function openMonthDistribute(page) {
  const button = page.getByRole('button', { name: 'Распределить по должностям', exact: true }).filter({ visible: true });
  if (await button.count()) await button.first().click();
  else {
    await page.getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('menuitem', { name: 'Распределить по должностям' }).click();
  }
  const dialog = page.getByRole('dialog', { name: 'Распределить по должностям' });
  await dialog.getByRole('button', { name: /^(Применить к\s\d+|Закрыть)$/ }).first().waitFor();
  return dialog;
}
// Экраны, которым нужны импортированные события июля 2026.
const NEEDS_JULY = ['m-month', 'm-calendar-dialog', 'm-event', 'm-pay', 'm-pay-details'];
const IMPORT_FIXTURE = 'tests/fixtures/demo-staff.xlsx';
const SCHEDULE_FIXTURE = 'tests/fixtures/schedule.xlsx';
// Месяцы далеко в будущем: реальных данных там нет, чистятся целиком.
const DRAFT_MONTH = '2098-12'; // засеянный черновик: таблица и повторная загрузка (лист «дек 98»)
const NEW_MONTH = '2098-11';   // пустой месяц: создание из расписания (лист «ноя 98»)
// Привязки чатов сида: id чатов Telegram положительные (личные) или очень большие отрицательные (группы),
// -1 и -2 реальными не бывают. Чистка по этим id работает и после прерванного прогона.
const CHAT_WORKER = -1;
const CHAT_MANAGER = -2;
const TYPE_NAME = `${PREFIX} · Закрытыйвечерорганноймузыкидляпартнёровфестиваля`;
const TYPE_ARCHIVED_NAME = `${PREFIX} · Архивный вечер`;
// Применение шаблона: вид, расходящийся с составом своих мероприятий, и вид без расхождений.
// Их мероприятия — в черновике APPLY_MONTH: работники его не видят, другие экраны его не открывают.
const APPLY_TYPE_NAME = `${PREFIX} · Состав для фестивальных вечеров`;
const SAME_TYPE_NAME = `${PREFIX} · Без расхождений`;
const APPLY_MONTH = '2098-10';
const EMPTY_SHEET_MONTH = '2099-01'; // лист «янв 99» без мероприятий Анненкирхе; только чтение, в базу не пишется

async function seed() {
  const [kind] = await sql`insert into event_type(name,sort_order) values (${TYPE_NAME},1000) returning id`;
  await sql`insert into event_type_slot(event_type_id,position_id,quantity,rate)
    select ${kind.id},id,default_quantity,case when name='ЗАЛ' then 2000 else 1500 end from position`;
  const [archivedKind] = await sql`insert into event_type(name,sort_order,archived)
    values (${TYPE_ARCHIVED_NAME},1001,true) returning id`;
  await sql`insert into event_type_slot(event_type_id,position_id,quantity)
    select ${archivedKind.id},id,default_quantity from position`;

  await sql`insert into manager_session (token_hash, expires_at)
            values (${hash(managerToken)}, now() + interval '1 hour')`;
  const [w] = await sql`
    insert into worker (full_name, name_key, phone, token_hash)
    values ('Константин Константинопольский-Преображенский',
            ${WORKER_KEY}, '+7 999 000-00-00', ${hash(workerToken)})
    returning id`;
  // Сессия работника на час; удаляется вместе с работником (on delete cascade) в cleanup().
  await sql`insert into worker_session (token_hash, worker_id, chat_id, expires_at)
            values (${hash(workerSessionToken)}, ${w.id}, null, now() + interval '1 hour')`;
  // Архивный работник с длинным именем — чтобы «Архив» не был пустым.
  await sql`
    insert into worker (full_name, name_key, phone, status)
    values ('Анастасия Константиновна Романовская-Оболенская',
            ${`${KEY_PREFIX} архив`}, '+7 999 000-00-01', 'archived')`;
  // Работник без должности на засеянном событии («Без должности» / «Не расставлены»).
  const [w2] = await sql`
    insert into worker (full_name, name_key, phone)
    values ('Ярослава Незаменимая-Безымянная',
            ${`${KEY_PREFIX} без должности`}, '+7 999 000-00-02')
    returning id`;
  const events = await sql`
    insert into event (event_date, start_time, arrive_time, concert, tag, base_rate)
    values
      (current_date + 3, '20:00', '18:00',
       ${`${PREFIX} · Закрытое мероприятие для партнёров фестиваля органной музыки`}, 'regular', 1300),
      (current_date + 4, '22:30', '21:00', ${`${PREFIX} · Ночной орган`}, 'night', 2000),
      (current_date + 5, '19:30', '17:30', ${`${PREFIX} · Сказочный мир`}, 'regular', 1300),
      (current_date - 2, '19:00', '17:00',
       ${`${PREFIX} · Прошедший концерт с очень длинным названием для экрана заработка`}, 'regular', 1300)
    returning id`;
  await sql`update event set program=${('Иоганн Себастьян Бах — Токката и фуга ре минор.\nКамерный ансамбль — сюита в четырёх частях.\n').repeat(5)},
    performers='Камерный ансамбль «Музыкальные истории»: орган, скрипка, виолончель, сопрано и баритон.' where id=${events[0].id}`;
  for (const e of events) {
    await sql`insert into event_slot (event_id, position_id, quantity)
              select ${e.id}, id, default_quantity from position where default_quantity > 0`;
  }
  await sql`update event set event_type_id=${kind.id} where id=${events[0].id}`;
  await sql`update event_slot s set type_rate=t.rate from event_type_slot t
    where s.event_id=${events[0].id} and t.event_type_id=${kind.id} and t.position_id=s.position_id`;
  const [tickets] = await sql`select id from position where name = 'БИЛЕТЫ'`;
  await sql`update event_slot set rate=2600 where event_id=${events[0].id} and position_id=${tickets.id}`;
  // Черновик месяца: таблица расстановки и экран повторной загрузки.
  await sql`insert into month (month, status) values (${DRAFT_MONTH}, 'draft')
            on conflict (month) do update set status = 'draft', published_at = null`;
  const draft = await sql`
    insert into event (event_date, start_time, arrive_time, arrive_manual, concert, source_title, tag, base_rate)
    values (${`${DRAFT_MONTH}-03`}, '19:00', '17:00', false, ${`${PREFIX} · Лунный свет`}, 'Лунный свет', 'regular', 1300),
           (${`${DRAFT_MONTH}-20`}, '20:00', '18:00', false,
            ${`${PREFIX} · Снятое с афиши мероприятие с длинным названием`}, 'Снятое мероприятие', 'regular', 1300)
    returning id`;
  await sql`update event set event_type_id=${kind.id} where id=${draft[0].id}`;
  for (const e of draft) {
    await sql`insert into event_slot (event_id, position_id, quantity)
              select ${e.id}, id, default_quantity from position where default_quantity > 0`;
  }
  await sql`insert into assignment (worker_id, event_id, position_id, plan_row)
            values (${w.id}, ${draft[0].id}, ${tickets.id}, 0), (${w2.id}, ${draft[1].id}, ${tickets.id}, 1)`;
  await sql`insert into assignment (worker_id, event_id, position_id, cancel_requested_at)
            values (${w.id}, ${events[0].id}, ${tickets.id}, null),
                   (${w.id}, ${events[1].id}, ${tickets.id}, now()),
                   (${w.id}, ${events[3].id}, ${tickets.id}, null),
                   (${w2.id}, ${events[0].id}, null, null)`;
  await sql`insert into signup (worker_id, event_id) values (${w.id}, ${events[2].id})`;
  // Засеянное событие (events[0]) целиком: заявка с длинным именем и запрос отмены.
  const [w3] = await sql`
    insert into worker (full_name, name_key, phone)
    values ('Александра Длиннофамильная-Кириллопольская',
            ${`${KEY_PREFIX} заявка`}, '+7 999 000-00-03')
    returning id`;
  const [w4] = await sql`
    insert into worker (full_name, name_key, phone)
    values ('Мстислав Всеволодович Преображенский-Заречный',
            ${`${KEY_PREFIX} отмена`}, '+7 999 000-00-04')
    returning id`;
  await sql`insert into signup (worker_id, event_id) values (${w3.id}, ${events[0].id})`;
  await sql`insert into assignment (worker_id, event_id, position_id, cancel_requested_at)
            values (${w4.id}, ${events[0].id}, ${tickets.id}, now())`;
  // Применение шаблона. Шаблон APPLY_TYPE_NAME: БИЛЕТЫ на одно место больше, ВХОД не нужен, ЗАЛ — 1.
  // У первого мероприятия ещё ЗАЛ 3 при двух людях («меньше нельзя») и нет БАЛКОНА («+1»);
  // одно мероприятие уже по шаблону («Без изменений»). SAME_TYPE_NAME — шаблон и состав совпадают.
  await sql`insert into month (month, status) values (${APPLY_MONTH}, 'draft')
            on conflict (month) do update set status = 'draft', published_at = null`;
  const [applyKind] = await sql`insert into event_type(name,sort_order) values (${APPLY_TYPE_NAME},1002) returning id`;
  await sql`insert into event_type_slot(event_type_id,position_id,quantity)
    select ${applyKind.id},id,case name when 'БИЛЕТЫ' then default_quantity+1 when 'ВХОД' then 0 when 'ЗАЛ' then 1
      else default_quantity end from position`;
  const [sameKind] = await sql`insert into event_type(name,sort_order) values (${SAME_TYPE_NAME},1003) returning id`;
  await sql`insert into event_type_slot(event_type_id,position_id,quantity)
    select ${sameKind.id},id,default_quantity from position`;
  const applyTitles = [
    'Утренний концерт для семей с детьми и друзей органной музыки', 'Баховские вечера', 'Орган и саксофон',
    'Музыка барокко при свечах', 'Хоровая ассамблея', 'Ночь органной импровизации', 'Камерный оркестр',
  ];
  const applyEvents = [];
  for (const [i, title] of applyTitles.entries()) {
    const [e] = await sql`insert into event (event_date, start_time, arrive_time, concert, event_type_id, base_rate)
      values (${`${APPLY_MONTH}-${String(i + 1).padStart(2, '0')}`}, '19:00', '17:00', ${`${PREFIX} · ${title}`}, ${applyKind.id}, 1300)
      returning id`;
    await sql`insert into event_slot (event_id, position_id, quantity)
              select ${e.id}, id, default_quantity from position where default_quantity > 0`;
    applyEvents.push(e.id);
  }
  const [matching] = await sql`insert into event (event_date, start_time, arrive_time, concert, event_type_id, base_rate)
    values (${`${APPLY_MONTH}-20`}, '19:00', '17:00', ${`${PREFIX} · Концерт уже по шаблону`}, ${applyKind.id}, 1300) returning id`;
  await sql`insert into event_slot (event_id, position_id, quantity)
            select ${matching.id}, position_id, quantity from event_type_slot where event_type_id = ${applyKind.id} and quantity > 0`;
  const [same] = await sql`insert into event (event_date, start_time, arrive_time, concert, event_type_id, base_rate)
    values (${`${APPLY_MONTH}-21`}, '19:00', '17:00', ${`${PREFIX} · Вечер без расхождений`}, ${sameKind.id}, 1300) returning id`;
  await sql`insert into event_slot (event_id, position_id, quantity)
            select ${same.id}, id, default_quantity from position where default_quantity > 0`;
  await sql`update event_slot set quantity = 3
            where event_id = ${applyEvents[0]} and position_id = (select id from position where name = 'ЗАЛ')`;
  await sql`delete from event_slot
            where event_id = ${applyEvents[0]} and position_id = (select id from position where name = 'БАЛКОН')`;
  await sql`insert into assignment (worker_id, event_id, position_id)
            select w.id, ${applyEvents[0]}, (select id from position where name = 'ЗАЛ') from worker w where w.id in (${w3.id}, ${w4.id})`;
  // Распределение по должностям: люди без должности на трёх мероприятиях APPLY_MONTH (на втором — трое).
  const distributeWorkers = [];
  for (const [i, name] of ['Евфросиния Длинноимённая-Нераспределённая', 'Пётр Ожидающий', 'Аглая Свободная'].entries()) {
    const [dw] = await sql`insert into worker (full_name, name_key, phone)
      values (${name}, ${`${KEY_PREFIX} распределение ${i}`}, ${`+7 999 000-00-1${i}`}) returning id`;
    distributeWorkers.push(dw.id);
  }
  for (const id of distributeWorkers) {
    await sql`insert into assignment (worker_id, event_id, position_id) values (${id}, ${applyEvents[1]}, null)`;
  }
  await sql`insert into assignment (worker_id, event_id, position_id)
            values (${distributeWorkers[0]}, ${applyEvents[0]}, null), (${distributeWorkers[1]}, ${applyEvents[2]}, null)`;
  const [july] = await sql`select id from event where event_date between '2026-07-01' and '2026-07-31'
                           and concert not like ${`${PREFIX}%`}
                           order by event_date, start_time limit 1`;
  const [months] = await sql`select to_char(current_date + 3, 'YYYY-MM') as seed,
                                    to_char(current_date - 2, 'YYYY-MM') as past`;
  return {
    workerId: w.id, seedEvent: events[0].id, julyEvent: july?.id, seedMonth: months.seed, pastMonth: months.past,
    applyEvent: applyEvents[0], distributeEvent: applyEvents[1],
  };
}

// Привязка чатов для экранов с `linked: true`; для остальных привязок нет.
async function setLinks(s, on) {
  await sql`delete from telegram_link where chat_id in (${CHAT_WORKER}, ${CHAT_MANAGER})`;
  if (on) {
    await sql`insert into telegram_link (worker_id, chat_id) values (${s.workerId}, ${CHAT_WORKER}), (null, ${CHAT_MANAGER})`;
  }
}

// Код входа засеянного работника через засеянный чат. Удаление привязки (setLinks) гасит коды
// работника (триггер 0013), поэтому код ставится заново после неё; работник удаляется в cleanup — с ним и код.
async function setLoginCode(s) {
  await sql`delete from worker_login_code where worker_id = ${s.workerId}`;
  await sql`insert into worker_login_code (code_hash, worker_id, chat_id, created_at, expires_at)
            values (${hash(loginCode)}, ${s.workerId}, ${CHAT_WORKER}, now(), now() + interval '1 hour')`;
}

// Месяцы дат, на которые seed() ставит события (current_date − 2 … + 5), у которых
// ещё нет записи month: её создаст триггер ensure_event_month, и cleanup() её уберёт.
async function missingSeedMonths() {
  const rows = await sql`
    select distinct to_char(current_date + d, 'YYYY-MM') as month
    from generate_series(-2, 5) as d
    where not exists (select 1 from month m where m.month = to_char(current_date + d, 'YYYY-MM'))`;
  return rows.map((r) => r.month);
}

// Не зависит от результата seed(): убирает и остатки прерванного прогона
// (хеши токенов и месяцы — из .pending), и данные этого запуска.
// .pending: { manager: [хеши], worker: [хеши], months: ['YYYY-MM'] }; months может не быть.
async function cleanup() {
  const hashes = [hash(managerToken)];
  const months = [];
  if (existsSync(PENDING)) {
    try {
      const p = JSON.parse(readFileSync(PENDING, 'utf8'));
      if (Array.isArray(p.manager)) hashes.push(...p.manager);
      if (archivedFixtureDb && p.database === dbUrl.pathname && Array.isArray(p.types)) {
        for(const t of p.types) await sql`update event_type set archived=${t.archived} where id=${t.id}`;
      }
      if (Array.isArray(p.months)) months.push(...p.months.filter((m) => /^\d{4}-\d{2}$/.test(m)));
    } catch { /* битый файл — пропускаем */ }
  }
  // Привязки и очередь — до всего остального; журнал tg_event — в самом конце: удаление событий и
  // работников само пишет в него (event_cancelled, removed, free_place), а связи без них не найти.
  await sql`delete from telegram_link where chat_id in (${CHAT_WORKER}, ${CHAT_MANAGER})`;
  await sql`delete from tg_outbox where chat_id in (${CHAT_WORKER}, ${CHAT_MANAGER})`;
  const eventIds = (await sql`select id from event where concert like ${`${PREFIX}%`}`).map((r) => r.id);
  const workerIds = (await sql`select id from worker where name_key like ${`${KEY_PREFIX}%`}`).map((r) => r.id);
  await sql`delete from event where concert like ${`${PREFIX}%`}`;
  await sql`delete from event_type_slot where event_type_id in (select id from event_type where name like ${`${PREFIX}%`})`;
  await sql`delete from event_type where name like ${`${PREFIX}%`}`;
  // Записи, созданные триггером для засеянных событий: только если в месяце не осталось событий.
  if (months.length) {
    await sql`delete from month where month in ${sql(months)}
              and not exists (select 1 from event where to_char(event_date, 'YYYY-MM') = month.month)`;
  }
  await sql`delete from month where month in (${DRAFT_MONTH}, ${NEW_MONTH}, ${APPLY_MONTH})`;
  await sql`delete from worker where name_key like ${`${KEY_PREFIX}%`}`;
  await sql`delete from manager_session where token_hash in ${sql(hashes)}`;
  const tgMonths = [...new Set([DRAFT_MONTH, NEW_MONTH, APPLY_MONTH, ...months])];
  await sql`delete from tg_event where event_id = any(${eventIds}::uuid[]) or worker_id = any(${workerIds}::uuid[])
            or month in ${sql(tgMonths)} or payload->>'concert' like ${`${PREFIX}%`}`;
  rmSync(PENDING, { force: true });
}

// Выполняется в браузере: список нарушений на странице.
function inspect() {
  const issues = [];
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  if (doc.scrollWidth > vw + 1) issues.push(`горизонтальная прокрутка: ${doc.scrollWidth} > ${vw}`);
  const label = (el) => `<${el.tagName.toLowerCase()}> «${(el.textContent ?? '').trim().slice(0, 40)}»`;

  for (const control of document.querySelectorAll('[role="combobox"]')) {
    if (!control.parentElement?.querySelector('input[name="eventTypeId"]')) continue;
    const rect = control.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const expected = vw < 1024 ? 44 : 36;
    if (Math.abs(rect.height - expected) > 1) issues.push(`высота выбора вида: ${rect.height}, нужна ${expected}`);
  }
  const bodyText = document.body.innerText;
  for (const marker of ['Application error', 'Что-то пошло не так']) {
    if (bodyText.includes(marker)) issues.push(`страница-ошибка: «${marker}»`);
  }
  const interLoaded = [...document.fonts].some((f) => f.family.includes('Inter')
    && !f.family.includes('Fallback') && f.status === 'loaded');
  if (!interLoaded) issues.push('шрифт не загружен: Inter');

  // Текст «принадлежит» элементу, если он лежит в нём самом или в цепочке строчных
  // потомков (<button><span>текст</span></button>): сама строчная обёртка не проверяется.
  const ownsText = (el) => [...el.childNodes].some((n) => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent.trim() !== '';
    if (!(n instanceof HTMLElement)) return false;
    const d = getComputedStyle(n).display;
    return (d === 'inline' || d === 'contents') && ownsText(n);
  });
  // Прямоугольники всех строк текста внутри элемента.
  const insideSrOnly = (node) => {
    for (let e = node.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      if (b.width <= 1 && b.height <= 1 && cs.position === 'absolute'
        && (cs.overflow === 'hidden' || cs.overflow === 'clip')) return true;
    }
    return false;
  };
  const textRects = (el, painted = false) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      if (!n.textContent.trim()) continue;
      // sr-only (1×1 px, absolute, overflow hidden/clip; текст может лежать и во вложенных элементах):
      // подпись кнопки-иконки не считается текстом вёрстки
      if (insideSrOnly(n)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) {
        let left = q.left;
        let right = q.right;
        if (painted) for (let a = n.parentElement; a && a !== el.parentElement; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.textOverflow !== 'ellipsis' || cs.overflowX === 'visible') continue;
          const box = a.getBoundingClientRect();
          left = Math.max(left,box.left);
          right = Math.min(right,box.right);
        }
        if (right-left > 0.5) out.push({left,right,top:q.top,bottom:q.bottom,height:q.height,width:right-left});
      }
    }
    return out;
  };
  const skipped = (el) => el.closest('[data-layout-scroll]') || el.closest('[aria-hidden="true"]');

  for (const el of document.querySelectorAll('body *')) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'inline' || cs.display === 'contents') continue;
    if (skipped(el)) continue;
    if (!ownsText(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // sr-only (1×1 px, скрыт для глаз намеренно) — не вёрстка
    if (r.width <= 1 && r.height <= 1) continue;
    if (r.right > vw + 1) issues.push(`вылезает за край экрана: ${label(el)}`);

    // Текст за левым краем экрана и текст, обрезанный предком (overflow hidden/clip).
    const rs = textRects(el);
    if (rs.length) {
      const L = Math.min(...rs.map((q) => q.left));
      const R = Math.max(...rs.map((q) => q.right));
      if (L < -1) issues.push(`текст за левым краем экрана: ${label(el)}`);
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflowX !== 'hidden' && acs.overflowX !== 'clip') continue;
        if (acs.textOverflow === 'ellipsis') break; // многоточие рисуется
        const ar = a.getBoundingClientRect();
        if (R > ar.right + 1 || L < ar.left - 1) {
          issues.push(`текст обрезан контейнером <${a.tagName.toLowerCase()}>: ${label(el)}`);
          break;
        }
      }
    }

    // Многоточие работает только вместе с overflow != visible
    const clipped = cs.overflowX !== 'visible';
    const ellipsis = (cs.textOverflow === 'ellipsis' && clipped)
      || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && cs.overflowY !== 'visible');
    if (ellipsis) {
      // Усечённое «…» без title (у себя или предка) — нарушение: полный текст недоступен.
      if (cs.textOverflow === 'ellipsis' && cs.webkitLineClamp === 'none'
        && el.scrollWidth > el.clientWidth + 1 && !el.closest('[title]')) {
        issues.push(`усечено «…» без title: ${label(el)}`);
      }
      continue;
    }
    if (el.scrollWidth > el.clientWidth + 1) issues.push(`текст не помещается по ширине: ${label(el)}`);
    // Прокручиваемый (auto/scroll) блок доступен целиком; обрезка — только hidden/clip
    if ((cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 1) {
      issues.push(`текст обрезан по высоте: ${label(el)}`);
    }
  }

  // Подписи кнопок, вкладок, меток и нижней панели — ровно одна строка.
  // Исключение — предок с data-allow-wrap.
  const SINGLE_LINE = '[data-nowrap], [data-slot="badge"], [data-slot="button"], [data-slot="tabs-trigger"], '
    + 'button, [role="tab"], nav a';
  for (const el of document.querySelectorAll(SINGLE_LINE)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (skipped(el) || el.closest('[data-allow-wrap]')) continue;
    // Range включает невидимый хвост усечённого текста. Для подписи кнопки
    // измеряем только нарисованную часть; обрезку без многоточия проверяем выше.
    const rs = textRects(el,true).sort((a, b) => a.top - b.top);
    if (!rs.length) continue;
    let lines = 0;
    let lastBottom = -Infinity;
    for (const q of rs) {
      if (q.top >= lastBottom - q.height / 2) { lines += 1; lastBottom = q.bottom; }
      else lastBottom = Math.max(lastBottom, q.bottom);
    }
    if (lines > 1) issues.push(`перенос строки (${lines}): ${label(el)}`);
    const L = Math.min(...rs.map((q) => q.left));
    const R = Math.max(...rs.map((q) => q.right));
    if (L < -1 || R > vw + 1) issues.push(`текст за краем экрана: ${label(el)}`);
    const b = el.getBoundingClientRect();
    if (L < b.left - 1 || R > b.right + 1) issues.push(`текст вылезает из своей рамки: ${label(el)}`);
  }

  // Бейдж и усечённый текст (ellipsis / line-clamp) не шире своей карточки:
  // overflow: visible у карточки не даёт ни прокрутки, ни обрезки, так что вылезание
  // за рамку иначе остаётся незамеченным (типичный случай — truncate внутри flex-предка
  // без min-w-0: предок растёт до ширины текста).
  // Контейнер — ближайший предок с data-contain, иначе — с видимой рамкой и скруглением.
  // data-allow-wrap на самом элементе или предке исключает его (closest включает сам элемент).
  const num = (v) => Number.parseFloat(v) || 0;
  const containerOf = (el) => {
    const marked = el.parentElement?.closest('[data-contain]');
    if (marked) return marked;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const c = getComputedStyle(a);
      if (num(c.borderLeftWidth) > 0 && num(c.borderRightWidth) > 0 && num(c.borderTopLeftRadius) > 0) return a;
    }
    return null;
  };
  const inScope = (el, cs) => el.matches('[data-nowrap], [data-slot="badge"]')
    || (cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible')
    || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
  for (const el of document.querySelectorAll('body *')) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (!inScope(el, cs)) continue;
    if (skipped(el) || el.closest('[data-allow-wrap]')) continue;
    const box = containerOf(el);
    if (!box) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    const r = box.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // display: contents и т. п.
    const c = getComputedStyle(box);
    const left = r.left + num(c.borderLeftWidth) + num(c.paddingLeft);
    const right = r.right - num(c.borderRightWidth) - num(c.paddingRight);
    if (b.left < left - 1 || b.right > right + 1) {
      const what = el.matches('[data-nowrap], [data-slot="badge"]') ? 'бейдж' : 'усечённый текст';
      issues.push(`${what} шире своей карточки: ${label(el)}`);
    }
  }

  // Содержимое открытого диалога и шторки — внутри их рамки (допуск 1 px). Radix выносит их
  // в портал, вне data-contain, а position: fixed не даёт прокрутки страницы: кнопка шире
  // диалога иначе видна проверке, только если дошла до края экрана.
  // Проверяются интерактивные элементы и элементы со своим текстом. Элемент внутри блока
  // с overflow ≠ visible (прокрутка, обрезка) заменяется этим блоком: прокручиваемое
  // содержимое доступно, обрезку текста ловит проверка выше, а сам блок обязан поместиться.
  // Если прокручивается сам диалог по вертикали — по вертикали не проверяется.
  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], '
    + '[role="option"], [role="menuitem"], [role="combobox"], [role="tab"], [tabindex]:not([tabindex="-1"])';
  const dialogLabel = (el) => ((el.textContent ?? '').trim() || !el.getAttribute('aria-label')
    ? label(el) : `<${el.tagName.toLowerCase()}> [${el.getAttribute('aria-label')}]`);
  for (const dlg of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    const ds = getComputedStyle(dlg);
    if (ds.display === 'none' || ds.visibility === 'hidden') continue;
    const d = dlg.getBoundingClientRect();
    if (d.width === 0 || d.height === 0) continue;
    const dialogScrollsY = ds.overflowY === 'auto' || ds.overflowY === 'scroll';
    const targets = new Set();
    for (const el of dlg.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'contents') continue;
      if (skipped(el)) continue;
      if (!el.matches(INTERACTIVE) && !(cs.display !== 'inline' && ownsText(el))) continue;
      let target = el;
      for (let a = el.parentElement; a && a !== dlg; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflowX !== 'visible' || acs.overflowY !== 'visible') target = a;
      }
      targets.add(target);
    }
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue; // sr-only
      const outX = r.left < d.left - 1 || r.right > d.right + 1;
      const outY = !dialogScrollsY && (r.top < d.top - 1 || r.bottom > d.bottom + 1);
      if (outX || outY) issues.push(`вылезает из диалога: ${dialogLabel(el)}`);
    }
  }

  // Слово не рвётся посередине. Проверяем только там, где разрыв слова разрешён
  // (overflow-wrap: break-word/anywhere, word-break: break-all/break-word): именно там
  // он и случается. Дефис и тире — законные места переноса, слово делится по ним.
  // Слово, которое целиком шире страницы (vw − 32), рвётся неизбежно — не нарушение.
  // Ширина контейнера тут не аргумент: break-words рвёт слово именно тогда, когда оно
  // шире строки, а строка обычно уже страницы.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const text = node.textContent;
    if (!text.trim()) continue;
    const host = node.parentElement;
    if (!host) continue;
    const hs = getComputedStyle(host);
    if (hs.display === 'none' || hs.visibility === 'hidden') continue;
    if (!['break-word', 'anywhere'].includes(hs.overflowWrap) && !['break-all', 'break-word'].includes(hs.wordBreak)) continue;
    if (skipped(host) || host.closest('[data-allow-wrap]')) continue;
    for (const m of text.matchAll(/[^\s\-\u2010-\u2015\/\u00AD\u200B]+/g)) {
      if ([...m[0]].length < 3) continue;
      const range = document.createRange();
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter((q) => q.width > 0.5);
      if (rects.length < 2) continue;
      const lines = rects.filter((q, i) => rects.findIndex((o) => Math.abs(o.top - q.top) < q.height / 2) === i);
      if (lines.length < 2) continue;
      const whole = rects.reduce((sum, q) => sum + q.width, 0);
      if (whole > vw - 32) continue; // шире страницы — разрыв неизбежен
      issues.push(`слово разорвано: «${m[0]}» в ${label(host)}`);
    }
  }

  // Контраст текста (WCAG 2.x). Цвета любого формата (rgb/oklch/color()/…) приводятся к sRGB
  // через 1×1 canvas. Пиксель считается так же, как рисует браузер: от фона страницы вниз по
  // всем предкам, у каждого — свой фон и своя opacity (группа: (1-op)·под ней + op·внутри).
  // Так считаются и фон, и текст, поэтому opacity любого предка — даже над непрозрачным
  // слоем — уменьшает контраст. Если где-то в цепочке есть background-image (градиент, картинка)
  // и он влияет на результат — фон определить нельзя, такой текст пропускается.
  // Проверяются текстовые узлы и значения/плейсхолдеры полей ввода (input, textarea).
  // Не проверяются: disabled / aria-disabled (и потомки), подписи отключённых полей,
  // скрытые, sr-only и текст, обрезанный предком до нулевого размера.
  // aria-hidden и data-layout-scroll не исключаются: текст виден глазами.
  const cv = document.createElement('canvas');
  cv.width = 1;
  cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  const rgba = (css) => {
    let v = colorCache.get(css);
    if (!v) {
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = '#000';
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      v = [d[0], d[1], d[2], d[3] / 255];
      colorCache.set(css, v);
    }
    return v;
  };
  const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t)); // t·a + (1−t)·b
  const lum = (c) => {
    const [r, gg, b] = c.map((x) => {
      const v = x / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  };
  const hex = (c) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
  const styleCache = new Map();
  const style = (e) => {
    let c = styleCache.get(e);
    if (!c) { c = getComputedStyle(e); styleCache.set(e, c); }
    return c;
  };
  const pageBase = style(document.documentElement).colorScheme.includes('dark') ? [18, 18, 18] : [255, 255, 255];
  // Фон под элементом после его собственного background: { under (цвет до слоя), out (после), unknown }.
  const layerCache = new Map();
  const layerOf = (e) => {
    let v = layerCache.get(e);
    if (v) return v;
    const c = style(e);
    const parent = e.parentElement ? layerOf(e.parentElement) : { out: pageBase, unknown: false };
    const bg = rgba(c.backgroundColor);
    const image = c.backgroundImage !== 'none';
    v = {
      under: parent.out,
      underUnknown: parent.unknown,
      op: Number.parseFloat(c.opacity),
      out: bg[3] > 0 ? mix(bg, parent.out, bg[3]) : parent.out,
      unknown: image || (parent.unknown && bg[3] < 0.999),
      parent: e.parentElement,
    };
    layerCache.set(e, v);
    return v;
  };
  // Итоговый пиксель фона (или текста, если fg задан) в точке элемента, либо null.
  const pixelOf = (el, fg, extraOpacity) => {
    const leaf = layerOf(el);
    if (leaf.unknown) return null;
    let v = fg ? mix(fg, leaf.out, fg[3] * extraOpacity) : leaf.out;
    for (let e = el; e; e = e.parentElement) {
      const l = layerOf(e);
      if (l.op >= 0.999) continue;
      if (l.underUnknown) return null;
      v = mix(v, l.under, l.op);
    }
    return v;
  };
  // Для скрытого намеренно: сам элемент или предок нулевого размера с обрезкой (sr-only, width:0).
  const clippedAway = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const ar = a.getBoundingClientRect();
      const acs = style(a);
      if ((ar.width <= 1 && acs.overflowX !== 'visible') || (ar.height <= 1 && acs.overflowY !== 'visible')) return true;
    }
    return false;
  };
  const labelDisabled = (el) => {
    const lab = el.closest('label');
    if (!lab) return false;
    if (lab.control?.disabled || lab.querySelector(':disabled')) return true;
    if (lab.closest('[data-disabled]:not([data-disabled="false"])')) return true;
    for (let p = lab.previousElementSibling; p; p = p.previousElementSibling) {
      if (p.matches('.peer:disabled, .peer[aria-disabled="true"]')) return true; // peer-disabled
    }
    return false;
  };
  const checkContrast = (el, cs, fgCss, extraOpacity, what) => {
    const fg = rgba(fgCss);
    if (fg[3] === 0) return;
    const bgPx = pixelOf(el, null, 1);
    if (!bgPx) return;
    const textPx = pixelOf(el, fg, extraOpacity);
    if (!textPx) return;
    const l1 = lum(textPx);
    const l2 = lum(bgPx);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = Number.parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number.parseInt(cs.fontWeight, 10) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      issues.push(`низкий контраст ${ratio.toFixed(1)}: ${what} (${hex(textPx)} на ${hex(bgPx)})`);
    }
  };
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  const NON_TEXT_INPUTS = ['checkbox', 'radio', 'hidden', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image'];
  for (const el of document.querySelectorAll('body *')) {
    if (!(el instanceof HTMLElement) || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue;
    const field = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NON_TEXT_INPUTS.includes(el.type));
    if (!field && !hasOwnText(el)) continue;
    const cs = style(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('[disabled], [aria-disabled="true"]') || el.matches(':disabled')) continue;
    if (field) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1 || clippedAway(el)) continue;
      if (el.value !== '') {
        checkContrast(el, cs, cs.webkitTextFillColor || cs.color, 1, `<${el.tagName.toLowerCase()}> значение «${el.value.slice(0, 40)}»`);
      } else if (el.placeholder) {
        const ph = getComputedStyle(el, '::placeholder');
        checkContrast(el, cs, ph.color, Number.parseFloat(ph.opacity), `<${el.tagName.toLowerCase()}> плейсхолдер «${el.placeholder.slice(0, 40)}»`);
      }
      continue;
    }
    const rs = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) if (q.width > 0.5 && q.height > 0.5) rs.push(q);
    }
    if (!rs.length || clippedAway(el) || labelDisabled(el)) continue;
    checkContrast(el, cs, cs.webkitTextFillColor || cs.color, 1, label(el));
  }
  return [...new Set(issues)];
}

// Ждёт конца конечных анимаций (появление диалога и шторки): контраст считается по
// итоговому цвету, а не по полупрозрачному кадру. Бесконечные (спиннер) не ждём.
async function settle(page) {
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
      .map((a) => a.finished.catch(() => {}))),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]));
}

// Одна комбинация экран × тема × ширина. Любое исключение — это нарушение, а не падение прогона.
async function checkOne(browser, screen, s, theme, width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce',
  });
  try {
    const cookie = screen.role === 'manager' ? { name: COOKIE.manager, value: managerToken }
      : screen.role === 'worker' ? { name: COOKIE.worker, value: workerSessionToken }
        : screen.role === 'worker-legacy' ? { name: 'worker_token', value: workerToken } : null;
    // Chromium принимает __Host-cookie через https-адрес того же localhost.
    if (cookie) await context.addCookies([{ ...cookie, url: BASE.replace(/^http:/, 'https:'), httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message).split('\n')[0]));
    const res = await page.goto(`${BASE}${screen.path(s)}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const status = res?.status() ?? 0;
    if (screen.steps) {
      await screen.steps(page, s);
      await settle(page);
    }
    const issues = status >= 400 ? [`HTTP ${status}`] : await page.evaluate(inspect);
    for (const e of pageErrors) issues.push(`ошибка JS на странице: ${e}`);
    if (!issues.length && screen.role && !screen.allowLogin && page.url().includes('/login')) issues.push('редирект на /login — нет доступа');
    await page.screenshot({ path: `${OUT}/${screen.name}-${theme}-${width}.png`, fullPage: true });
    return issues;
  } finally {
    await context.close();
  }
}

async function main() {
  const screens = SCREENS.filter((x) => (!only || x.name.startsWith(only)) && (!x.when || x.when())
    && (!x.name.includes('google') || Boolean(process.env[x.name.startsWith('m-concert') ? 'NEXT_PUBLIC_GOOGLE_CONCERTS_SHEET_ID'
      : x.name.startsWith('m-month-new') ? 'NEXT_PUBLIC_GOOGLE_SCHEDULE_SHEET_ID' : 'NEXT_PUBLIC_GOOGLE_STAFF_SHEET_ID'])));
  if (!screens.length) {
    console.error(`--only=${only}: нет экранов с таким префиксом. Доступны: ${SCREENS.map((x) => x.name).join(', ')}`);
    return 2;
  }

  let s;
  let browser;
  let failed = 0;
  let skipped = 0;
  let code = 0;
  // Сигнал не чистит сам (иначе гонка с cleanup в finally): останавливает прогон,
  // а очистку и sql.end() делает finally — ровно один раз.
  let aborted = false;
  const onSignal = () => {
    aborted = true;
    browser?.close().catch(() => {});
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, onSignal);

  try {
    // Остатки прерванного прогона; затем — запись хешей и недостающих месяцев ДО вставки (на случай SIGKILL).
    await cleanup();
    writeFileSync(PENDING, JSON.stringify({
      manager: [hash(managerToken)], worker: [hash(workerToken)], months: await missingSeedMonths(), database: dbUrl.pathname,
      types: archivedFixtureDb ? await sql`select id,archived from event_type` : [],
    }));

    if (screens.some((x) => NEEDS_JULY.includes(x.name))) {
      const [{ n }] = await sql`select count(*)::int as n from event
                                where event_date between '2026-07-01' and '2026-07-31'`;
      if (!n) {
        throw new Error('в dev-базе нет событий июля 2026 — экраны m-month, m-event, m-pay были бы пустыми. '
          + 'Импортируйте июль (см. /import) и запустите снова.');
      }
    }

    // Свои обработчики сигналов у Playwright отключены: иначе он завершает процесс раньше очистки.
    browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
    s = await seed();
    const types = archivedFixtureDb ? await sql`select id,archived from event_type` : [];
    let previousArchived = false;
    for (const screen of screens) {
      if (screen.allTypesArchived && !archivedFixtureDb) throw new Error('Состояние «все виды в архиве» проверяется только в отдельной локальной базе *_layout');
      if (screen.allTypesArchived || previousArchived) {
        for (const t of types) await sql`update event_type set archived=${screen.allTypesArchived ? true : t.archived} where id=${t.id}`;
      }
      previousArchived = screen.allTypesArchived === true;
      await setLinks(s, screen.linked === true);
      if (screen.loginCode) await setLoginCode(s);
      if (forcedWidth !== null && screen.widths && !screen.widths.includes(forcedWidth)) {
        console.log(`– ${screen.name}: пропущен — ширины экрана ${screen.widths.join(', ')}, не ${forcedWidth}`);
        skipped += 1;
        continue;
      }
      const roleWidths = screen.role === 'worker' ? WORKER_WIDTHS
        : screen.role === 'manager' ? MANAGER_WIDTHS : [...WORKER_WIDTHS, ...MANAGER_WIDTHS];
      const widths = forcedWidth !== null ? [forcedWidth]
        : (screen.widths ?? [...roleWidths, ...(screen.extraWidths ?? [])].sort((a, b) => a - b));
      for (const theme of THEMES) {
        for (const width of widths) {
          if (aborted) break;
          const tag = `${screen.name} ${theme} ${width}`;
          let issues;
          try {
            issues = await checkOne(browser, screen, s, theme, width);
          } catch (e) {
            issues = [`исключение: ${String(e?.message ?? e).split('\n')[0]}`];
          }
          if (aborted) break;
          if (issues.length) {
            failed += 1;
            console.log(`✗ ${tag}`);
            for (const i of issues.slice(0, 10)) console.log(`    ${i}`);
          } else {
            console.log(`✓ ${tag}`);
          }
        }
      }
    }
    if (aborted) throw new Error('прогон прерван сигналом');
    if (skipped) console.log(`\nПропущено экранов (не их ширина): ${skipped}`);
    console.log(failed ? `\nНарушений: ${failed} комбинаций` : '\nВсё ровно');
    code = failed ? 1 : 0;
  } catch (e) {
    console.error(`\nОшибка прогона: ${e?.message ?? e}`);
    code = aborted ? 130 : 1;
  } finally {
    await browser?.close().catch(() => {});
    try {
      await cleanup();
    } catch (e) {
      console.error(`Очистка не удалась (данные могли остаться): ${e?.message ?? e}`);
      code = code || 1;
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }
  return code;
}

process.exit(await main());
