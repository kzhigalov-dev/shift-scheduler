<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Приложение для записи на смены (Анненкирхе)

## Правила проекта

- Node.js 24+, Next.js 16 App Router. Pages Router не использовать.
- TypeScript `strict`. `any` запрещён; `unknown` — только на границах ввода:
  `src/lib/import/workbook.ts`, `src/lib/import/prepare.ts`, `src/lib/schedule/selection.ts`,
  `src/lib/telegram/prefs.ts`, `src/lib/telegram/update.ts`, `src/lib/distribute/rows.ts`,
  `src/lib/telegram/webApp.ts` (initData Mini App), `src/app/tg/actions.ts`.
- Интерфейс на русском. Часовой пояс `Europe/Moscow`. Деньги — рубли, целые.
- Даты `YYYY-MM-DD`, время `HH:MM`, месяц `YYYY-MM`.
- Тесты пишутся до кода. Коммит в конце задачи, на русском. Push не делать.

## Доступ к базе

- Применённые миграции (`supabase/migrations/*.sql`, уже ушедшие в облако) не правятся никогда: любое исправление —
  новой миграцией (`create or replace`, `drop … if exists` + `create`, `add column if not exists`). Иначе базы,
  применившие прежний текст, молча расходятся с облаком. Пример и проверка схождения — `0013_review_fixes.sql`,
  `tests/migrationConvergence.test.ts`.

- Только через `withAnon` / `withWorker` / `withManager` из `src/db/client.ts`.
  Операции принимают `tx: Tx` и соединений не открывают.
- Приложение ходит ролью `app_user` с RLS. `app_user` не владеет таблицами.
- Каждая новая таблица — с RLS и политиками; `tests/rls.test.ts` это проверяет.
- Вход по токенам и запрос отмены — функции `security definer` в `0002_rls.sql`.
  Новые такие функции: `set search_path = public, pg_temp`.
- Новые функции в public по умолчанию никому не исполнимы (default privileges):
  каждой функции, которую зовёт приложение или политика, — явный
  `grant execute on function … to app_user`.
- Уведомления в Telegram пишут триггеры в `tg_event`; новые виды — триггер + обработка в
  `src/lib/telegram/process.ts` (тексты — `messages.ts`, настройки — `prefs.ts`). Ключ бота —
  только `TELEGRAM_BOT_TOKEN`, нигде не печатать; в тестах и проверке вёрстки в Telegram не ходить.
- Кнопки и команды бота (`src/lib/telegram/buttons.ts`, `commands.ts`) действуют от имени владельца
  чата (`telegram_owner`): работник — `withWorker`, менеджер — `withManager` и только из чата менеджера;
  только теми же доменными функциями, что кнопки приложения, без своих запросов в обход. Данные кнопок —
  `callbacks.ts` (`<op>:<id>[:<id>]` и `pm:YYYY-MM`, до 64 байт); новая кнопка — операция там же, обработка в `buttons.ts`.
- Тексты бота — HTML (`parse_mode: 'HTML'`): всё из базы и от людей — только через `escapeHtml`
  (`src/lib/telegram/html.ts`), внутри `<b>` заголовка — только постоянный текст; адрес приложения —
  URL-кнопкой `withAppLink` / `appButton` (только `https://`), не в тексте; итог нажатия — `appendLine`
  (курсив, обрезка по видимому тексту до `MAX_TEXT`). Постоянное меню — `menu.ts` (`WORKER_MENU`,
  `MANAGER_MENU`): новая кнопка меню — подпись там же и ветка команды в `commands.ts`.
- Вход работника из бота — только `/tg/app` (Mini App: подпись initData — `verifyInitData`, повтор и сессия —
  `webapp_login`) и прежняя `/tg/<код>`. GET любых ссылок входа (и личной `/w/<токен>`) ничего не меняет: вход — POST
  (server action) после «Войти как <Имя>?»; сессия и закрытие прежних ролей браузера — одной транзакцией
  (`openWorkerSession`). Личная ссылка меняется на сессию (`personal_link_login`, chat_id null): токен ссылки в cookie
  не кладётся. Имена cookie — только `cookieNames.ts` (`__Host-` на бою); старые имена — только чтение и перенос
  (`/auth/upgrade`, `src/proxy.ts`).
  Коды и сессии помнят чат: удаление привязки закрывает их триггером `end_worker_chat_access`. initData, hash,
  коды и токены не логировать.
- Ключи подписки на календарь — `calendar_feed` (только хеши), поиск без входа —
  `calendar_worker_by_token` / `calendar_manager_token_valid` (security definer).
- Виды: `event_type` — названия, `event_type_slot` — шаблоны. Изменения шаблона и архива сначала блокируют вид `FOR UPDATE`; создание читает его `FOR SHARE`. Копировать состав только при создании, через `copyEventTypeSlots`; к существующим будущим мероприятиям — только `applyTypeTemplate` / `applyEventTemplate` (`src/lib/eventTypes/applyTemplate.ts`): места блокируются до подсчёта людей, никто не снимается. `system_tag` неизменяем; UI использует имя из базы, `event_tag` остаётся технической классификацией.
- Ставки вида: `event_type_slot.rate` → снимок `event_slot.type_rate`; ручная `event_slot.rate` имеет приоритет. Сохранение ставок вида обновляет снимки только у ещё не начавшихся мероприятий (`event_date + start_time > localtimestamp` — часы базы, без `today` из JS), через `saveEventType`, с порядком блокировок вид → мероприятия → места. Прошлые снимки и ручные/личные ставки сохраняются. Триггер `inherit_slot_type_rate` только заполняет пустой снимок и не смотрит на дату (новое мероприятие задним числом получает ставку вида); правило «новое место на начавшемся мероприятии — без снимка» — в `setSlot` и `writePlans` при применении шаблона вида или мероприятия. Пустая ставка вида — общая ставка должности, затем базовая ставка мероприятия; ноль — явная сумма. При правке мероприятия сначала блокировать выбранный вид, затем мероприятие.
- Распределение людей без должности — только `src/lib/distribute/`: `distribute` / `overLimit` — чистые, случайность — параметром (на сервере `secureRandomInt`). `applyDistribution` блокирует мероприятия (`FOR SHARE`, по `event_date, start_time` — как шаблон вида), места (`FOR UPDATE`, по `event_id, position_id`) до подсчёта людей, затем только присланные пары назначений; каждую строку из браузера проверяет заново, АДМИН не заполняет.
- Вставка в `signup` разрешена `app_user` только по колонкам
  `(worker_id, event_id, status)`; заявки работника — `on conflict do nothing`.

## Границы модулей

- `parseSheet.ts`, `calculatePay.ts`, `normalizeName.ts` — чистые функции.
- Выгрузка месяца: `src/lib/export/monthSheet.ts` — чистая функция (без exceljs), оформление — только там;
  `writeWorkbook.ts` переносит описание в exceljs, `loadMonth.ts` берёт места из `getMonthPlan`.
  Файл обязан читаться импортом без замечаний (`tests/monthExport.test.ts`); проверку данных
  (выпадающие списки) в выгрузку не добавлять.
- `'use server'`-файлы и Route Handlers — только обёртки с проверкой прав.
- Каждая страница, action и route проверяет права сам, первой строкой
  (`requireManager` / `requireWorker` / `isManager`) — до обращения к базе.
  Проверка в `layout.tsx` не защищает ни страницы, ни actions: при клиентской
  навигации layout не перерисовывается. `tests/access.test.ts` это проверяет.
- Текст ошибки для пользователя — только `UserError` (`src/lib/errors.ts`).
  Actions и маршруты показывают ошибки через `userMessage(error)`; сырые
  ошибки базы на экран не попадают.

## Интерфейс

Публикуемая ветка содержит только код и демонстрационные данные.

- Метки для `npm run check:layout` (ставятся на элементы вёрстки):
  - `data-contain` — граница карточки: бейджи и усечённый текст внутри не должны выходить за её поля;
  - `data-allow-wrap` — на элементе или предке: перенос строки и разрыв слов здесь допустимы (длинные текстовые блоки);
  - `data-layout-scroll` — блок с намеренной горизонтальной прокруткой (таблица), внутри не проверяется;
  - `data-nowrap` — подпись, которая обязана оставаться в одну строку (бейдж-метка; `StatusBadge` ставит сам).
  Длинные e-mail и URL: `break-all` + `data-allow-wrap`, иначе проверка «слово разорвано».
- Действие с уведомлением — только через `src/components/useRunAction.ts` (тост успеха/ошибки, `pending`,
  пробрасывает redirect Next). Своих копий `runAction` не заводить.
- Цветные метки статуса — `StatusBadge` (`src/components/StatusBadge.tsx`), не самодельные span.
- Даты, деньги и числа с единицами — только через `src/lib/format.ts` (неразрывные пробелы: «9 июля», «1 300 ₽»).
  Составные подписи вроде «Начало 20:00» — с `\u00a0`.
- Высоты элементов управления: `h-11` на телефоне, `lg:h-9` на ноутбуке (в диалогах и формах — всегда пара).
- Цвета — только токены из `src/app/globals.css` (`bg-background`, `text-muted-foreground`, `bg-status-*` …).
  Жёстких `text-gray-*`, `#hex`, `rgb()` нет. Новая пара «текст/фон» — в `tests/theme.test.ts`.
- Тема — по `prefers-color-scheme`; класса `.dark` и переключателя нет.
- Марка: знак `BrandMark` и `BrandLockup` (знак + «Анненкирхе» + «смены»); Lora (`font-brand`) — только для
  словесной марки. Цвета марки вне CSS (манифест, theme-color, иконки) — `src/lib/brand.ts`, они обязаны
  совпадать с `globals.css` (`tests/theme.test.ts`). Иконки (`icon.svg`, `apple-icon.png`, `favicon.ico`,
  `public/icon-192/512.png`) — только через `node scripts/brand-icons.mjs`, руками не править.
- Таблица расстановки: таблица от 768 px, карточки уже; логика ячеек — только в `usePlanEditing` (чистые функции — `src/lib/monthPlan/planView.ts`).
- Кабинет работника: боковое меню от 1024 px (`WorkerShell`), карточки сеткой — `layout="grid"`.
- Сводки (заполненность, ждут решения, нехватка, ближайшая смена, столбики заработка) — чистые функции
  `src/lib/summaries/`, данные — уже загруженные запросы под `withWorker` / `withManager`, не больше запроса на виджет.
  Нехватка людей — только `understaffedItems` (`src/lib/telegram/process.ts`). Дата словами — `dateInWords` (`format.ts`).
- Иллюстрации — только `Illustration` (`src/components/Illustration.tsx`): свои линейные SVG, `currentColor` + `--primary`,
  `aria-hidden`. Декор не отодвигает рабочее содержимое на телефоне: колонки справа (`WorkerShell aside`, `WithAside`) —
  от 1280 px, у «Месяца» — от 1440 px (уже ячейки календаря не помещаются), ниже — строка-сводка.
- Пояснения и пустые состояния — с точкой; кнопки, заголовки, метки — без.
- После любого изменения экранов: `npm run build`, `npx next start -p 3100`, `npm run check:layout` —
  всё должно быть `✓` (см. «Проверка вёрстки» в README). Новый экран или состояние (диалог, шторка) — в `SCREENS`
  скрипта, с хуком `steps`, если нужно открыть состояние.

## Тесты

- Только локальная база `*_test` (`tests/setup.ts` проверяет). Файлы идут по очереди.
- Поведение под ролью приложения проверять через `asWorker` / `asManager` / `asAppAnon`.

## Секреты

Только в `.env.local`. Учётные данные билетных систем и Wi-Fi из исходной
таблицы в репозиторий не попадают ни в каком виде.
