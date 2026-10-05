-- Исправления по полному ревью безопасности 2026-10-03 (.superpowers/sdd/full-security-review-2026-10-03.md).
-- Применённые миграции не правятся (AGENTS.md): функции пересоздаются целиком (create or replace),
-- таблицы и индексы — if not exists, права выдаются заново. Повторное применение безопасно
-- (tests/migrationConvergence.test.ts).

-- ── M1. Перевыпуск ссылки и архив гасят и ключ календаря ──────────────────────────────────────
-- Все учётные данные работника гаснут вместе: сессии, коды входа из бота и ключ подписки на календарь
-- (`/cal/<ключ>.ics`). Иначе ключ, полученный по украденной ссылке, читал бы смены и оплату и после
-- перевыпуска; возврат из архива оживил бы старый ключ.
create or replace function end_worker_sessions(p_worker uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not is_manager() then
    raise exception 'permission denied: сессии работника закрывает только менеджер' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from worker where id = p_worker for update;
  delete from worker_session where worker_id = p_worker;
  delete from worker_login_code where worker_id = p_worker;
  delete from calendar_feed where worker_id = p_worker;
end
$$;
revoke all on function end_worker_sessions(uuid) from public;
grant execute on function end_worker_sessions(uuid) to app_user;

-- ── M3. Поток заявок одного работника ─────────────────────────────────────────────────────────
-- Заявки и отзывы работника (приложение и кнопки бота — createSignup / withdrawSignup) ограничены
-- на сервере: не больше 60 за 10 минут всего и не больше 6 за час на одно мероприятие.
-- Учёт — строки signup_toggle за последний час (старее удаляются здесь же); приложению таблица закрыта.
create table if not exists signup_toggle (
  id bigint generated always as identity primary key,
  worker_id uuid not null references worker(id) on delete cascade,
  event_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists signup_toggle_worker_at on signup_toggle (worker_id, at);
create index if not exists signup_toggle_at on signup_toggle (at);
alter table signup_toggle enable row level security;
drop policy if exists signup_toggle_none on signup_toggle;
create policy signup_toggle_none on signup_toggle for select using (false);
revoke all on signup_toggle from public;
revoke all on sequence signup_toggle_id_seq from public;

-- true — переключение учтено и разрешено; false — слишком часто (= SIGNUP_* в src/app/(worker)/queries.ts).
-- Работник — из личности сессии. Рекомендательная блокировка на работника: параллельные запросы
-- не обходят лимит.
create or replace function note_signup_toggle(p_event uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid := current_worker_id();
begin
  if v_worker is null or is_manager() then
    raise exception 'permission denied: заявки подаёт только работник' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('signup_toggle:' || v_worker::text, 0));
  delete from signup_toggle where at < now() - interval '1 hour';
  if (select count(*) from (select 1 from signup_toggle
      where worker_id = v_worker and at > now() - interval '10 minutes' limit 60) recent) >= 60 then
    return false;
  end if;
  if (select count(*) from (select 1 from signup_toggle
      where worker_id = v_worker and event_id = p_event and at > now() - interval '1 hour' limit 6) recent) >= 6 then
    return false;
  end if;
  insert into signup_toggle (worker_id, event_id) values (v_worker, p_event);
  return true;
end
$$;
revoke all on function note_signup_toggle(uuid) from public;
grant execute on function note_signup_toggle(uuid) to app_user;

-- Заявка, пока прежняя запись о ней ещё не обработана тиком, новую запись в журнал не пишет:
-- повторы (заявка → отзыв → заявка) сливаются в одно уведомление менеджеру.
create index if not exists tg_event_signup_pending on tg_event (worker_id, event_id)
  where kind = 'm_signup' and processed_at is null;
create or replace function tg_on_signup() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    if not exists (select 1 from tg_event where kind = 'm_signup' and worker_id = new.worker_id
                   and event_id = new.event_id and processed_at is null) then
      perform tg_note('m_signup', new.worker_id, new.event_id, null, null);
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'rejected' and old.status <> 'rejected' then
    perform tg_note('rejected', new.worker_id, new.event_id, null, null);
  end if;
  return null;
end
$$;
revoke all on function tg_on_signup() from public;

-- ── L3. Общий предел неудачных входов менеджера ───────────────────────────────────────────────
-- К пределу на адрес (10 неудач за 15 минут, 0010) — общий: если за час со всех адресов набралось
-- 100 неудач (перебор через много прокси), адресу, где уже ошибались, остаются 3 попытки за 15 минут.
-- Адрес без своих неудач входит всегда: перебор не может запереть менеджера, а только замедляет себя.
-- Режим кончается сам через час после последних неудач. = LOGIN_* в src/lib/auth/loginThrottle.ts.
create or replace function login_under_attack() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*) >= 100 from (
    select 1 from login_failure where at > now() - interval '1 hour' limit 100
  ) recent
$$;

create or replace function login_allowed(p_ip_hash text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*) < case when login_under_attack() then 3 else 10 end from (
    select 1 from login_failure
    where ip_hash = p_ip_hash and at > now() - interval '15 minutes'
    limit 10
  ) recent
$$;
revoke all on function login_under_attack(), login_allowed(text) from public;
grant execute on function login_under_attack(), login_allowed(text) to app_user;

-- ── L5. initData Mini App действуют час, а не сутки ───────────────────────────────────────────
-- Как в 0014 (лимит пяти входов в минуту под рекомендательной блокировкой), меняется только срок записи
-- защиты от повтора: он равен сроку приёма initData. Записи, сделанные до 0015, доживают свои сутки.
create or replace function webapp_login(
  p_init_hash text, p_user_id bigint, p_auth_date timestamptz, p_session_hash text, p_current_hash text
) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid;
begin
  if current_worker_id() is not null or is_manager() then
    return 'denied';
  end if;
  -- Блокировка живёт до конца транзакции, охватывая проверку лимита и запись попытки.
  -- Ключ отдельный для каждого пользователя; пространство имён не пересекается с другими задачами.
  -- Порядок: лимит пользователя → worker → telegram_link, как у остальных проверок доступа.
  perform pg_advisory_xact_lock(hashtextextended('telegram_webapp_login:' || p_user_id::text, 0));
  delete from telegram_webapp_login where expires_at < now();
  if (select count(*) from telegram_webapp_login
      where user_id = p_user_id and created_at > now() - interval '1 minute') >= 5 then
    return 'too_often';
  end if;
  -- Запись живёт весь срок, в который приложение принимает этот initData (час и 5 минут сдвига часов,
  -- WEBAPP_MAX_AGE_SECONDS в src/lib/telegram/webApp.ts).
  insert into telegram_webapp_login (init_hash, user_id, expires_at)
  values (p_init_hash, p_user_id, greatest(p_auth_date, now()) + interval '1 hour 5 minutes')
  on conflict (init_hash) do nothing;
  if not found then
    return 'replay';
  end if;
  select worker_id into v_worker from telegram_link where chat_id = p_user_id;
  if not found then
    return 'unlinked';
  end if;
  if v_worker is null then
    return 'manager';
  end if;
  perform 1 from worker where id = v_worker and status = 'active' for update;
  if not found then
    return 'archived';
  end if;
  -- Одновременное отключение ждёт этот вход, а затем его триггер закрывает и эту сессию.
  perform 1 from telegram_link where worker_id = v_worker and chat_id = p_user_id for share;
  if not found then
    return 'unlinked';
  end if;
  if exists (select 1 from worker_session where token_hash = p_current_hash and worker_id = v_worker
             and chat_id = p_user_id and expires_at > now()) then
    return 'kept';
  end if;
  insert into worker_session (token_hash, worker_id, chat_id, expires_at)
  values (p_session_hash, v_worker, p_user_id, clock_timestamp() + interval '1 year');
  delete from worker_session where worker_id = v_worker and (expires_at < now() or token_hash not in (
    select token_hash from worker_session where worker_id = v_worker order by created_at desc limit 20));
  return 'ok';
end
$$;
revoke all on function webapp_login(text, bigint, timestamptz, text, text) from public;
grant execute on function webapp_login(text, bigint, timestamptz, text, text) to app_user;

-- ── L6. Личная ссылка меняется на сессию работника ────────────────────────────────────────────
-- Раньше cookie `worker_token` хранила сам токен ссылки на год: кража cookie = ссылка навсегда. Теперь
-- «Войти» на /w/<токен>/confirm создаёт сессию работника (как вход из бота), в cookie — только её токен.
-- У такой сессии нет чата (chat_id null): отключение Telegram её не закрывает (триггер
-- end_worker_chat_access гасит только сессии своего чата), перевыпуск ссылки и архив — закрывают
-- (end_worker_sessions). Сессии из бота по-прежнему всегда с чатом.
alter table worker_session alter column chat_id drop not null;

-- Только из сессии без личности; ссылка действующего работника → сессия на год. Порядок блокировок — как
-- у входа по коду: сначала работник. У работника остаются 20 последних сессий, истёкшие удаляются.
create or replace function personal_link_login(p_token_hash text, p_session_hash text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid;
begin
  if current_worker_id() is not null or is_manager() then
    return false;
  end if;
  select id into v_worker from worker where token_hash = p_token_hash and status = 'active' for update;
  if not found then
    return false;
  end if;
  insert into worker_session (token_hash, worker_id, chat_id, expires_at)
  values (p_session_hash, v_worker, null, clock_timestamp() + interval '1 year');
  delete from worker_session where worker_id = v_worker and (expires_at < now() or token_hash not in (
    select token_hash from worker_session where worker_id = v_worker order by created_at desc limit 20));
  return true;
end
$$;
revoke all on function personal_link_login(text, text) from public;
grant execute on function personal_link_login(text, text) to app_user;

-- ── L4. pg_net: очередь запросов не для всех ─────────────────────────────────────────────────
-- В облаке pg_net (схема net, владелец supabase_admin) выдаёт PUBLIC все права на net.http_request_queue и
-- net._http_response и EXECUTE на net.http_post: app_user (как и anon/authenticated) может прочитать секрет
-- тика из заголовка поставленного в очередь запроса, переписать его адрес и слать свои запросы из базы.
-- Отозвать права PUBLIC может только владелец объектов (или роль с правом передачи). Блок ниже:
--   * без pg_net (локальная база, тесты) — ничего не делает;
--   * у выполняющей роли нет права передачи (обычный postgres в Supabase) — ничего не меняет, только WARNING;
--   * иначе — сначала явно выдаёт права тем, кому pg_net нужен (postgres: задание pg_cron и фоновый процесс
--     pg_net — pg_net.username; служебные роли Supabase), затем отзывает у PUBLIC, anon, authenticated и app_user.
-- Схему net и само расширение не трогает. Тик (pg_cron от postgres → net.http_post) продолжает работать
-- (проверено локально, см. .superpowers/sdd/security-full-fixes-report.md).
do $$
declare
  v_keep text[] := array['postgres', 'supabase_admin', 'supabase_functions_admin', 'service_role'];
  v_drop text[] := array['public', 'anon', 'authenticated', 'app_user'];
  v_role text;
  v_rel record;
  v_fn regprocedure;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;
  -- Права передачи нужны на все таблицы и функции схемы (по oid: сигнатуры разнятся между версиями pg_net).
  if exists (select 1 from pg_class c where c.relnamespace = 'net'::regnamespace and c.relkind in ('r', 'S')
             and not has_table_privilege(c.oid, 'select with grant option'))
     or exists (select 1 from pg_proc p where p.pronamespace = 'net'::regnamespace
                and not has_function_privilege(p.oid, 'execute with grant option')) then
    raise warning 'pg_net: у роли % нет права передачи на объекты схемы net — права PUBLIC не отозваны (ревью L4). '
      'Выполните этот блок от владельца pg_net (supabase_admin).', current_user;
    return;
  end if;
  foreach v_role in array v_keep loop
    continue when v_role = current_user or not exists (select 1 from pg_roles where rolname = v_role);
    execute format('grant usage on schema net to %I', v_role);
    for v_rel in select c.oid::regclass as rel, c.relkind from pg_class c
                 where c.relnamespace = 'net'::regnamespace and c.relkind in ('r', 'S') loop
      if v_rel.relkind = 'S' then
        execute format('grant usage, select, update on sequence %s to %I', v_rel.rel, v_role);
      else
        execute format('grant select, insert, update, delete on table %s to %I', v_rel.rel, v_role);
      end if;
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'net'::regnamespace loop
      execute format('grant execute on function %s to %I', v_fn, v_role);
    end loop;
  end loop;
  foreach v_role in array v_drop loop
    continue when v_role <> 'public' and not exists (select 1 from pg_roles where rolname = v_role);
    for v_rel in select c.oid::regclass as rel, c.relkind from pg_class c
                 where c.relnamespace = 'net'::regnamespace and c.relkind in ('r', 'S') loop
      execute format('revoke all on %s %s from %s',
        case when v_rel.relkind = 'S' then 'sequence' else 'table' end, v_rel.rel,
        case when v_role = 'public' then 'public' else quote_ident(v_role) end);
    end loop;
    for v_fn in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'net'::regnamespace loop
      execute format('revoke all on function %s from %s', v_fn,
        case when v_role = 'public' then 'public' else quote_ident(v_role) end);
    end loop;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'app_user') and (
       exists (select 1 from pg_class c where c.relnamespace = 'net'::regnamespace and c.relkind = 'r'
               and has_table_privilege('app_user', c.oid, 'select'))
       or exists (select 1 from pg_proc p where p.pronamespace = 'net'::regnamespace
                  and has_function_privilege('app_user', p.oid, 'execute'))) then
    raise warning 'pg_net: app_user всё ещё читает очередь или вызывает функции net (ревью L4)';
  end if;
exception when others then
  -- Укрепление pg_net не должно ронять миграцию: его изменения откатываются целиком, остальное — применяется.
  raise warning 'pg_net: права не изменены (%: %)', sqlstate, sqlerrm;
end $$;

-- ── Supabase открывает public через REST ролям anon и authenticated (см. 0002_rls.sql) ─────────
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on signup_toggle from anon, authenticated;
    revoke all on sequence signup_toggle_id_seq from anon, authenticated;
    revoke all on function end_worker_sessions(uuid), note_signup_toggle(uuid), tg_on_signup(),
      login_under_attack(), login_allowed(text), webapp_login(text, bigint, timestamptz, text, text),
      personal_link_login(text, text)
      from anon, authenticated;
  end if;
end $$;
