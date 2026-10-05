create or replace function current_worker_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.worker_id', true), '')::uuid
$$;

create or replace function is_manager() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.is_manager', true) = 'true', false)
$$;

alter table worker          enable row level security;
alter table position        enable row level security;
alter table event           enable row level security;
alter table event_slot      enable row level security;
alter table signup          enable row level security;
alter table assignment      enable row level security;
alter table manager_session enable row level security;

create policy worker_read on worker for select
  using (is_manager() or id = current_worker_id());
create policy worker_manage on worker for all
  using (is_manager()) with check (is_manager());

create policy position_read on position for select
  using (is_manager() or current_worker_id() is not null);
create policy position_manage on position for all
  using (is_manager()) with check (is_manager());

create policy event_read on event for select
  using (is_manager() or current_worker_id() is not null);
create policy event_manage on event for all
  using (is_manager()) with check (is_manager());

create policy slot_read on event_slot for select
  using (is_manager() or current_worker_id() is not null);
create policy slot_manage on event_slot for all
  using (is_manager()) with check (is_manager());

create policy signup_read on signup for select
  using (is_manager() or worker_id = current_worker_id());
create policy signup_create on signup for insert
  with check (is_manager() or (worker_id = current_worker_id() and status = 'pending'));
create policy signup_withdraw on signup for delete
  using (is_manager() or (worker_id = current_worker_id() and status = 'pending'));
create policy signup_manage on signup for update
  using (is_manager()) with check (is_manager());

create policy assignment_read on assignment for select
  using (is_manager() or worker_id = current_worker_id());
create policy assignment_manage on assignment for all
  using (is_manager()) with check (is_manager());

create policy manager_session_manage on manager_session for all
  using (is_manager()) with check (is_manager());

-- Функции security definer выполняются от владельца таблиц и обходят RLS.
-- Поэтому каждая делает ровно одно дело и ищет строго по хешу или по
-- текущему работнику.

create or replace function worker_by_token(p_token_hash text)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.full_name from worker w
  where w.token_hash = p_token_hash and w.status = 'active'
$$;

create or replace function manager_session_valid(p_token_hash text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from manager_session
    where token_hash = p_token_hash and expires_at > now()
  )
$$;

create or replace function request_cancel(p_event_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  update assignment
  set cancel_requested_at = now()
  where event_id = p_event_id
    and worker_id = current_worker_id()
    and cancel_requested_at is null
    and exists (
      select 1 from event e where e.id = p_event_id and e.event_date >= (now() at time zone 'Europe/Moscow')::date
    );
  return found;
end
$$;

revoke execute on function worker_by_token(text), manager_session_valid(text),
  request_cancel(uuid) from public;
grant execute on function worker_by_token(text), manager_session_valid(text),
  request_cancel(uuid) to app_user;

-- current_worker_id()/is_manager() читают GUC приложения и не должны быть
-- вызываемыми анонимно через REST — закрываем PUBLIC EXECUTE и здесь.
revoke execute on function current_worker_id(), is_manager() from public;
grant  execute on function current_worker_id(), is_manager() to app_user;

-- Любая будущая функция в public по умолчанию не должна быть исполняемой
-- никем, кроме тех, кому явно выдан EXECUTE.
-- Новые функции в public по умолчанию никому не исполнимы. Если функцию
-- вызывает приложение или политика RLS — явный
-- `grant execute on function … to app_user`. Вставка в signup разрешена
-- только по колонкам (worker_id, event_id, status); свои id/created_at
-- потребуют отдельного grant insert.
alter default privileges revoke execute on functions from public;

-- Колоночные права на вставку заявки: работник не должен иметь возможность
-- проставить created_at (и любую другую служебную колонку) вручную.
revoke insert on signup from app_user;
grant insert (worker_id, event_id, status) on signup to app_user;

-- Supabase открывает схему public через REST ролям anon и authenticated.
-- Приложению REST не нужен — закрываем полностью, включая будущие объекты.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon, authenticated;
    revoke all on all functions in schema public from anon, authenticated;
    revoke all on all sequences in schema public from anon, authenticated;
    alter default privileges in schema public revoke all on tables from anon, authenticated;
    alter default privileges in schema public revoke all on functions from anon, authenticated;
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
  end if;
end
$$;
