-- Защита входа менеджера от перебора пароля: неудачные попытки по хешу IP.
-- Хранится только sha256('login:' || ip) в hex — сам адрес в базу не попадает
-- (проверка формата ниже не даёт записать его по ошибке).
create table login_failure (
  id bigserial primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  at timestamptz not null default now()
);
create index login_failure_ip_at on login_failure (ip_hash, at);
-- Уборка старых строк идёт при каждой неудаче: без индекса по времени это был бы
-- полный просмотр таблицы, которую перебор с многих адресов может раздуть.
create index login_failure_at on login_failure (at);

alter table login_failure enable row level security;
-- Гранта app_user нет: читают и пишут только login_allowed / note_login_failure.
create policy login_failure_none on login_failure for select using (false);
revoke all on login_failure from public;
revoke all on sequence login_failure_id_seq from public;

-- Вход разрешён, пока у адреса меньше 10 неудач за последние 15 минут.
-- limit 10 — считать дальше порога незачем, даже если строк тысячи.
create or replace function login_allowed(p_ip_hash text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*) < 10 from (
    select 1 from login_failure
    where ip_hash = p_ip_hash and at > now() - interval '15 minutes'
    limit 10
  ) recent
$$;

-- Неудачная попытка. Строки старше суток больше ни на что не влияют — удаляются здесь же.
create or replace function note_login_failure(p_ip_hash text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  insert into login_failure (ip_hash) values (p_ip_hash);
  delete from login_failure where at < now() - interval '1 day';
end
$$;

revoke all on function login_allowed(text), note_login_failure(text) from public;
grant execute on function login_allowed(text), note_login_failure(text) to app_user;

-- 0009 создала таблицы видов без явного revoke и полагалась на default privileges
-- из 0002 (ревью безопасности 2026-10-02, I1). Закрываем явно, как в 0006/0007.
-- Права app_user не меняются.
revoke all on event_type, event_type_slot from public;

-- Supabase открывает public через REST ролям anon и authenticated (см. 0002_rls.sql): закрываем и новые объекты.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on login_failure from anon, authenticated;
    revoke all on sequence login_failure_id_seq from anon, authenticated;
    revoke all on function login_allowed(text), note_login_failure(text) from anon, authenticated;
    revoke all on event_type, event_type_slot from anon, authenticated;
  end if;
end $$;
