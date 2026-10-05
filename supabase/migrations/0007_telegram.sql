-- Telegram: привязки чатов, одноразовые коды, журнал событий для уведомлений,
-- очередь сообщений, служебное состояние и секрет тика.

create table telegram_link (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references worker(id) on delete cascade,
  chat_id bigint not null unique,
  prefs jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create unique index telegram_link_one_per_worker on telegram_link (worker_id) where worker_id is not null;
-- Выражение постоянно (true) для всех строк под условием — значит, строка менеджера одна.
create unique index telegram_link_one_manager on telegram_link ((worker_id is null)) where worker_id is null;

create table telegram_link_code (
  code_hash text primary key,
  worker_id uuid references worker(id) on delete cascade,
  expires_at timestamptz not null
);

create table tg_event (
  id bigint generated always as identity primary key,
  kind text not null,
  worker_id uuid,
  event_id uuid,
  month text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index tg_event_pending on tg_event (id) where processed_at is null;

create table tg_outbox (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  text text not null,
  reply_markup jsonb,
  dedupe_key text unique,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
create index tg_outbox_due on tg_outbox (send_after) where sent_at is null;

create table app_state (name text primary key, value text not null);
create table app_secret (name text primary key, value text not null);
-- 64 hex-символа из двух uuid: gen_random_bytes (pgcrypto) на Supabase лежит в схеме
-- extensions и зависел бы от search_path.
insert into app_secret (name, value)
values ('tick', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

alter table telegram_link enable row level security;
alter table telegram_link_code enable row level security;
alter table tg_event enable row level security;
alter table tg_outbox enable row level security;
alter table app_state enable row level security;
alter table app_secret enable row level security;

-- Привязку создаёт только link_telegram (чат подтверждён Telegram через вебхук):
-- приложение читает, удаляет и меняет настройки, но не chat_id.
grant select, delete on telegram_link to app_user;
grant update (prefs) on telegram_link to app_user;
-- telegram_link_code: гранта app_user нет — коды выдаёт issue_telegram_code, гасит link_telegram.
grant select, insert, update, delete on tg_outbox, app_state to app_user;
grant select, update, delete on tg_event to app_user;
-- app_secret: гранта app_user нет — читает только функция tick_secret_valid.

create policy telegram_link_manage on telegram_link for all using (is_manager()) with check (is_manager());
create policy telegram_link_own on telegram_link for all
  using (worker_id = current_worker_id()) with check (worker_id = current_worker_id());
create policy telegram_link_code_none on telegram_link_code for select using (false);
create policy tg_event_manage on tg_event for all using (is_manager()) with check (is_manager());
create policy tg_outbox_manage on tg_outbox for all using (is_manager()) with check (is_manager());
create policy app_state_manage on app_state for all using (is_manager()) with check (is_manager());
create policy app_secret_none on app_secret for select using (false);

-- Код подключения: владелец — из личности сессии (не из аргумента), срок — здесь же.
-- Прежние коды того же владельца удаляются.
create or replace function issue_telegram_code(p_code_hash text, p_for_manager boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid;
begin
  if p_for_manager then
    if not is_manager() then
      raise exception 'permission denied: код менеджера выдаёт только менеджер' using errcode = 'insufficient_privilege';
    end if;
    delete from telegram_link_code where worker_id is null;
  else
    v_worker := current_worker_id();
    if v_worker is null then
      raise exception 'permission denied: код выдаётся только работнику' using errcode = 'insufficient_privilege';
    end if;
    delete from telegram_link_code where worker_id = v_worker;
  end if;
  insert into telegram_link_code (code_hash, worker_id, expires_at)
  values (p_code_hash, v_worker, now() + interval '15 minutes'); -- = LINK_CODE_MINUTES (src/lib/telegram/links.ts)
end
$$;

-- chat_id принимается на веру: функцию зовёт только вебхук, проверивший секрет
-- Telegram (X-Telegram-Bot-Api-Secret-Token), а chat_id берётся из обновления Telegram.
-- Код одноразовый атомарно: delete … returning; код архивного работника тоже гасится.
create or replace function link_telegram(p_code_hash text, p_chat_id bigint) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid;
begin
  delete from telegram_link_code where code_hash = p_code_hash and expires_at > now()
  returning worker_id into v_worker;
  if not found then
    return 'invalid';
  end if;
  if v_worker is not null and not exists (select 1 from worker where id = v_worker and status = 'active') then
    return 'invalid';
  end if;
  delete from telegram_link where chat_id = p_chat_id;
  if v_worker is null then
    delete from telegram_link where worker_id is null;
  else
    delete from telegram_link where worker_id = v_worker;
  end if;
  insert into telegram_link (worker_id, chat_id) values (v_worker, p_chat_id);
  return case when v_worker is null then 'manager' else 'worker' end;
end
$$;

create or replace function telegram_owner(p_chat_id bigint) returns table (worker_id uuid, is_manager boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.worker_id, l.worker_id is null from telegram_link l
  left join worker w on w.id = l.worker_id
  where l.chat_id = p_chat_id and (l.worker_id is null or w.status = 'active')
$$;

create or replace function tick_secret_valid(p_secret text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from app_secret where name = 'tick' and value = p_secret)
$$;

revoke execute on function issue_telegram_code(text, boolean), link_telegram(text, bigint),
  telegram_owner(bigint), tick_secret_valid(text) from public;
grant execute on function issue_telegram_code(text, boolean), link_telegram(text, bigint),
  telegram_owner(bigint), tick_secret_valid(text) to app_user;

-- ── Журнал событий: пишут только триггеры (security definer, в обход RLS). ──

create or replace function tg_note(p_kind text, p_worker uuid, p_event uuid, p_month text, p_payload jsonb) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into tg_event (kind, worker_id, event_id, month, payload) values (p_kind, p_worker, p_event, p_month, coalesce(p_payload, '{}'))
$$;
revoke execute on function tg_note(text, uuid, uuid, text, jsonb) from public;

create or replace function tg_event_snapshot(p_event uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'date', to_char(event_date, 'YYYY-MM-DD'), 'start', to_char(start_time, 'HH24:MI'),
    'arrive', to_char(arrive_time, 'HH24:MI'), 'concert', concert)
  from event where id = p_event
$$;
revoke execute on function tg_event_snapshot(uuid) from public;

create or replace function tg_on_assignment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_snap jsonb;
begin
  if tg_op = 'INSERT' then
    perform tg_note('assigned', new.worker_id, new.event_id, null, null);
  elsif tg_op = 'UPDATE' then
    if new.position_id is distinct from old.position_id then
      perform tg_note('assigned', new.worker_id, new.event_id, null, null);
    end if;
    if old.cancel_requested_at is null and new.cancel_requested_at is not null then
      perform tg_note('m_cancel', new.worker_id, new.event_id, null, null);
    elsif old.cancel_requested_at is not null and new.cancel_requested_at is null then
      perform tg_note('kept', new.worker_id, new.event_id, null, null);
    end if;
  else
    v_snap := tg_event_snapshot(old.event_id);
    -- Мероприятие удаляется целиком — «отменено» пишет триггер на event.
    if v_snap is not null then
      perform tg_note(case when old.cancel_requested_at is not null then 'cancel_approved' else 'removed' end,
                      old.worker_id, old.event_id, null, v_snap);
      perform tg_note('free_place', null, old.event_id, null, null);
    end if;
  end if;
  return null;
end
$$;
create trigger tg_assignment after insert or update or delete on assignment
  for each row execute function tg_on_assignment();

create or replace function tg_on_event_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_snap jsonb := jsonb_build_object(
    'date', to_char(old.event_date, 'YYYY-MM-DD'), 'start', to_char(old.start_time, 'HH24:MI'),
    'arrive', to_char(old.arrive_time, 'HH24:MI'), 'concert', old.concert);
  v_worker uuid;
begin
  for v_worker in select worker_id from assignment where event_id = old.id loop
    perform tg_note('event_cancelled', v_worker, old.id, null, v_snap);
  end loop;
  return old;
end
$$;
create trigger tg_event_delete before delete on event
  for each row execute function tg_on_event_delete();

create or replace function tg_on_event_time() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid;
begin
  if new.event_date is distinct from old.event_date or new.start_time is distinct from old.start_time
     or new.arrive_time is distinct from old.arrive_time then
    for v_worker in select worker_id from assignment where event_id = new.id loop
      perform tg_note('time_changed', v_worker, new.id, null, null);
    end loop;
  end if;
  return null;
end
$$;
create trigger tg_event_time after update on event
  for each row execute function tg_on_event_time();

create or replace function tg_on_signup() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform tg_note('m_signup', new.worker_id, new.event_id, null, null);
  elsif tg_op = 'UPDATE' and new.status = 'rejected' and old.status <> 'rejected' then
    perform tg_note('rejected', new.worker_id, new.event_id, null, null);
  end if;
  return null;
end
$$;
create trigger tg_signup after insert or update on signup
  for each row execute function tg_on_signup();

create or replace function tg_on_month() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'draft' and new.status = 'published' then
    perform tg_note('published', null, null, new.month, null);
  end if;
  return null;
end
$$;
create trigger tg_month after update on month
  for each row execute function tg_on_month();

create or replace function tg_on_slot() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Добавили должность (insert) или места (update с ростом quantity).
  if new.quantity > 0 and (tg_op = 'INSERT' or new.quantity > old.quantity) then
    perform tg_note('free_place', null, new.event_id, null, null);
  end if;
  return null;
end
$$;
create trigger tg_slot after insert or update on event_slot
  for each row execute function tg_on_slot();

-- Триггерные и служебные функции приложение не вызывает: исполнять их никому не нужно.
revoke execute on function tg_on_assignment(), tg_on_event_delete(), tg_on_event_time(),
  tg_on_signup(), tg_on_month(), tg_on_slot() from public;

-- Supabase открывает public через REST ролям anon и authenticated (см. 0002_rls.sql): закрываем и новые объекты.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on telegram_link, telegram_link_code, tg_event, tg_outbox, app_state, app_secret
      from anon, authenticated;
    revoke all on sequence tg_event_id_seq, tg_outbox_id_seq from anon, authenticated;
    revoke all on function issue_telegram_code(text, boolean), link_telegram(text, bigint), telegram_owner(bigint), tick_secret_valid(text),
      tg_note(text, uuid, uuid, text, jsonb), tg_event_snapshot(uuid),
      tg_on_assignment(), tg_on_event_delete(), tg_on_event_time(),
      tg_on_signup(), tg_on_month(), tg_on_slot()
      from anon, authenticated;
  end if;
end $$;
