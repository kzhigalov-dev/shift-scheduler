-- Исправления по ревью 2026-10-03 (.superpowers/sdd/current-version-review.md) и вход из Telegram Mini App.
--
-- Применённые миграции не правятся (AGENTS.md). 0011 и 0012 правились после применения, поэтому
-- базы, собранные из их ранних текстов, расходятся с облаком. Эта миграция идемпотентна и приводит
-- к одному состоянию любую базу — собранную и из ранних, и из окончательных текстов 0011/0012
-- (tests/migrationConvergence.test.ts): функции пересоздаются целиком, триггеры — drop if exists + create,
-- права выдаются заново.

-- ── Коды и сессии помнят чат, через который получены (M1) ─────────────────────────────────────
alter table worker_login_code add column if not exists chat_id bigint;
alter table worker_session add column if not exists chat_id bigint;
create index if not exists worker_session_chat on worker_session (worker_id, chat_id);
-- Сессии до 0013 получены только через нынешний чат работника — других путей не было.
update worker_session s set chat_id = l.chat_id from telegram_link l
  where l.worker_id = s.worker_id and s.chat_id is null;
-- Без чата остаются сессии работников, отключивших Telegram: доступ через отключённый чат закрывается.
delete from worker_session where chat_id is null;
-- Невыданные коды без чата (срок — 15 минут) не гасятся: чат у них не проверить.
delete from worker_login_code where chat_id is null;
alter table worker_login_code alter column chat_id set not null;
alter table worker_session alter column chat_id set not null;

-- ── Выдача кода: чат обязателен (L8) и запоминается (M1) ──────────────────────────────────────
-- Ранняя 0011 создавала перегрузку (text); окончательная — (text, bigint default null). Default
-- через create or replace не убрать — пересоздаём.
drop function if exists issue_worker_login_code(text);
drop function if exists issue_worker_login_code(text, bigint);
create function issue_worker_login_code(p_code_hash text, p_chat_id bigint) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid := current_worker_id();
begin
  if v_worker is null or is_manager() then
    raise exception 'permission denied: код входа выдаётся только работнику' using errcode = 'insufficient_privilege';
  end if;
  if p_chat_id is null then
    raise exception 'permission denied: код входа выдаётся только в подключённый чат' using errcode = 'insufficient_privilege';
  end if;
  -- Порядок блокировок выдачи, входа и отзыва: worker → telegram_link → код/сессия.
  perform 1 from worker where id = v_worker and status = 'active' for update;
  if not found then
    raise exception 'permission denied: работник в архиве' using errcode = 'insufficient_privilege';
  end if;
  -- FOR SHARE: одновременное отключение ждёт выдачу, а затем его триггер гасит и этот код.
  perform 1 from telegram_link where worker_id = v_worker and chat_id = p_chat_id for share;
  if not found then
    raise exception 'permission denied: чат больше не подключён к работнику' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from worker_login_code
             where worker_id = v_worker and created_at > clock_timestamp() - interval '30 seconds') then
    return false; -- = LOGIN_CODE_EVERY_SECONDS (src/lib/auth/workerSession.ts)
  end if;
  delete from worker_login_code where worker_id = v_worker;
  insert into worker_login_code (code_hash, worker_id, chat_id, created_at, expires_at)
  values (p_code_hash, v_worker, p_chat_id, clock_timestamp(), clock_timestamp() + interval '15 minutes'); -- = LOGIN_CODE_MINUTES
  return true;
end
$$;

-- ── Вход по коду: чат кода всё ещё подключён к работнику (M1) ──────────────────────────────────
-- Код гасится и сессия создаётся в одной транзакции. Привязка читается без блокировки: отключение
-- блокирует привязку, затем коды — взять привязку после кода значило бы взаимную блокировку. Гонку
-- закрывает триггер отключения: он гасит коды (ждёт этот вход), затем сессии чата — уже с этой.
create or replace function redeem_worker_login_code(p_code_hash text, p_session_hash text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid;
  v_chat bigint;
begin
  if current_worker_id() is not null or is_manager() then
    return false;
  end if;
  select worker_id into v_worker from worker_login_code
  where code_hash = p_code_hash and used_at is null and expires_at > clock_timestamp();
  if not found then
    return false;
  end if;
  perform 1 from worker where id = v_worker and status = 'active' for update;
  if not found then
    return false;
  end if;
  update worker_login_code set used_at = clock_timestamp()
  where code_hash = p_code_hash and used_at is null and expires_at > clock_timestamp()
    and worker_id = v_worker
  returning chat_id into v_chat;
  if not found then
    return false;
  end if;
  if not exists (select 1 from telegram_link where worker_id = v_worker and chat_id = v_chat) then
    return false;
  end if;
  insert into worker_session (token_hash, worker_id, chat_id, expires_at)
  values (p_session_hash, v_worker, v_chat, clock_timestamp() + interval '1 year');
  delete from worker_session where worker_id = v_worker and (expires_at < now() or token_hash not in (
    select token_hash from worker_session where worker_id = v_worker order by created_at desc limit 20));
  return true;
end
$$;

-- Состояние кода для страницы подтверждения /tg/[code] (L3) и понятного ответа на повтор (L4).
-- Ничего не меняет. Имя — только у действующего кода.
create or replace function worker_login_code_state(p_code_hash text) returns table (state text, full_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select x.state, case when x.state = 'valid' then x.full_name end
  from (
    select case
             when c.used_at is not null then 'used'
             when c.expires_at <= now() then 'expired'
             when w.status <> 'active'
               or not exists (select 1 from telegram_link l where l.worker_id = c.worker_id and l.chat_id = c.chat_id)
               then 'invalid'
             else 'valid'
           end as state,
           w.full_name
    from worker_login_code c join worker w on w.id = c.worker_id
    where c.code_hash = p_code_hash
  ) x
$$;

-- Без изменений по смыслу; пересоздаются, чтобы базы из ранней 0011 получили окончательные тексты.
create or replace function worker_by_session(p_token_hash text) returns table (id uuid, full_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.full_name from worker_session s join worker w on w.id = s.worker_id
  where s.token_hash = p_token_hash and s.expires_at > now() and w.status = 'active'
$$;

create or replace function end_worker_session(p_token_hash text) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  delete from worker_session where token_hash = p_token_hash
$$;

create or replace function end_worker_sessions(p_worker uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not is_manager() then
    raise exception 'permission denied: сессии работника закрывает только менеджер' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from worker where id = p_worker for update;
  delete from worker_session where worker_id = p_worker;
  delete from worker_login_code where worker_id = p_worker;
end
$$;

-- Закрыть сессию менеджера этого браузера в той же транзакции, что и вход работника (L4): знает токен — его сессия.
create or replace function end_manager_session(p_token_hash text) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  delete from manager_session where token_hash = p_token_hash
$$;

-- ── Отключение чата закрывает вход через него (M1, L2) ────────────────────────────────────────
-- Любое удаление привязки работника (кнопка «Отключить», перевыпуск ссылки, архив, привязка чата
-- к другому работнику) гасит коды работника и сессии, полученные через этот чат. Сессию браузера,
-- из которого нажали «Отключить», приложение сохраняет: app.keep_worker_session — хеш её токена.
create or replace function end_worker_chat_access() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.worker_id is null then
    return null;
  end if;
  -- Сначала коды: идущий вход по коду держит его строку — ждём его, затем видим и его сессию.
  delete from worker_login_code where worker_id = old.worker_id;
  delete from worker_session where worker_id = old.worker_id and chat_id = old.chat_id
    and token_hash is distinct from nullif(current_setting('app.keep_worker_session', true), '');
  return null;
end
$$;
drop trigger if exists telegram_link_end_access on telegram_link;
create trigger telegram_link_end_access after delete on telegram_link
  for each row execute function end_worker_chat_access();

-- Архив отключает Telegram работника (L2): восстановление не возвращает вход из бота.
delete from telegram_link l using worker w where w.id = l.worker_id and w.status = 'archived';

-- ── Ставка вида у новых мест (M2) ────────────────────────────────────────────────────────────
-- Триггер только заполняет пустой снимок и не смотрит на дату: новое мероприятие задним числом
-- получает ставку вида. Правило «прошедшему мероприятию новое место без снимка» — в setSlot
-- (src/app/(manager)/event/[id]/operations.ts), единственном пути добавления места к существующему.
create or replace function inherit_slot_type_rate() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.type_rate is null then
    select t.rate into new.type_rate
      from event e join event_type_slot t on t.event_type_id = e.event_type_id
      where e.id = new.event_id and t.position_id = new.position_id;
  end if;
  return new;
end
$$;
drop trigger if exists event_slot_type_rate on event_slot;
create trigger event_slot_type_rate before insert on event_slot
  for each row execute function inherit_slot_type_rate();

-- ── Вход из Telegram Mini App ─────────────────────────────────────────────────────────────────
-- Подпись initData проверяет приложение (src/lib/telegram/webApp.ts); здесь — защита от повтора
-- (каждый hash initData принимается один раз за срок его действия), лимит и сессия работника.
create table if not exists telegram_webapp_login (
  init_hash text primary key check (init_hash ~ '^[0-9a-f]{64}$'),
  user_id bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists telegram_webapp_login_user on telegram_webapp_login (user_id, created_at);
alter table telegram_webapp_login enable row level security;
drop policy if exists telegram_webapp_login_none on telegram_webapp_login;
create policy telegram_webapp_login_none on telegram_webapp_login for select using (false);
revoke all on telegram_webapp_login from public;

-- Только из сессии без личности. Итог: ok — создана сессия; kept — браузер уже вошёл этим работником
-- через этот чат (p_current_hash — хеш его cookie): новая сессия не нужна и не вытесняет сессии других
-- устройств (у работника хранятся 20 последних); replay — этот initData уже принимали;
-- too_often — больше 5 входов за минуту от этого пользователя; unlinked — чат не подключён;
-- manager — чат менеджера (сессии работника нет); archived — работник в архиве; denied — есть личность.
-- Личный чат с ботом: chat_id = user.id. Порядок блокировок — как у выдачи кода: worker → telegram_link.
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
  delete from telegram_webapp_login where expires_at < now();
  if (select count(*) from telegram_webapp_login
      where user_id = p_user_id and created_at > now() - interval '1 minute') >= 5 then
    return 'too_often';
  end if;
  -- Запись живёт весь срок, в который приложение принимает этот initData (сутки и 5 минут сдвига часов).
  insert into telegram_webapp_login (init_hash, user_id, expires_at)
  values (p_init_hash, p_user_id, greatest(p_auth_date, now()) + interval '1 day 5 minutes')
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
  -- FOR SHARE: одновременное отключение ждёт этот вход, а затем его триггер закрывает и эту сессию.
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

-- ── Права ─────────────────────────────────────────────────────────────────────────────────────
revoke all on function issue_worker_login_code(text, bigint), redeem_worker_login_code(text, text),
  worker_login_code_state(text), worker_by_session(text), end_worker_session(text), end_worker_sessions(uuid),
  end_manager_session(text), webapp_login(text, bigint, timestamptz, text, text),
  end_worker_chat_access(), inherit_slot_type_rate() from public;
grant execute on function issue_worker_login_code(text, bigint), redeem_worker_login_code(text, text),
  worker_login_code_state(text), worker_by_session(text), end_worker_session(text), end_worker_sessions(uuid),
  end_manager_session(text), webapp_login(text, bigint, timestamptz, text, text) to app_user;

-- Supabase открывает public через REST ролям anon и authenticated (см. 0002_rls.sql): закрываем и новые объекты.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on telegram_webapp_login from anon, authenticated;
    revoke all on function issue_worker_login_code(text, bigint), redeem_worker_login_code(text, text),
      worker_login_code_state(text), worker_by_session(text), end_worker_session(text), end_worker_sessions(uuid),
      end_manager_session(text), webapp_login(text, bigint, timestamptz, text, text),
      end_worker_chat_access(), inherit_slot_type_rate() from anon, authenticated;
  end if;
end $$;
