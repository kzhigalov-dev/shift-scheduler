-- Ключи подписки на календарь. Хранится только sha256 ключа.
-- worker_id = null — ключ менеджера (один на приложение).
create table calendar_feed (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references worker(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
create unique index calendar_feed_one_per_worker on calendar_feed (worker_id) where worker_id is not null;
create unique index calendar_feed_one_manager on calendar_feed ((worker_id is null)) where worker_id is null;

alter table calendar_feed enable row level security;
grant select, insert, delete on calendar_feed to app_user;

create policy calendar_feed_manage on calendar_feed for all
  using (is_manager()) with check (is_manager());
create policy calendar_feed_own on calendar_feed for all
  using (worker_id = current_worker_id()) with check (worker_id = current_worker_id());

-- Лента открывается без входа: поиск ключа — в обход RLS, строго по хешу.
create or replace function calendar_worker_by_token(p_token_hash text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select f.worker_id from calendar_feed f join worker w on w.id = f.worker_id
  where f.token_hash = p_token_hash and w.status = 'active'
$$;

create or replace function calendar_manager_token_valid(p_token_hash text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from calendar_feed where token_hash = p_token_hash and worker_id is null)
$$;

revoke execute on function calendar_worker_by_token(text), calendar_manager_token_valid(text) from public;
grant execute on function calendar_worker_by_token(text), calendar_manager_token_valid(text) to app_user;

-- Supabase открывает public через REST ролям anon и authenticated (см. 0002_rls.sql): закрываем и новые объекты.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on calendar_feed from anon, authenticated;
    revoke all on function calendar_worker_by_token(text), calendar_manager_token_valid(text) from anon, authenticated;
  end if;
end $$;
