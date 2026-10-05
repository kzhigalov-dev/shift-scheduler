create extension if not exists pgcrypto;

create type worker_status as enum ('active', 'archived');
create type signup_status as enum ('pending', 'accepted', 'rejected');
create type event_tag as enum ('regular', 'chapel', 'night', 'seder', 'organ', 'excursion');

create table worker (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  name_key text not null unique,
  phone text,
  status worker_status not null default 'active',
  token_hash text unique,
  token_issued_at timestamptz,
  created_at timestamptz not null default now()
);

create table position (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null,
  default_quantity integer not null default 1 check (default_quantity >= 0),
  default_rate integer check (default_rate >= 0)
);

create table event (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  start_time time not null,
  arrive_time time,
  concert text,
  tag event_tag not null default 'regular',
  base_rate integer check (base_rate >= 0),
  comment text,
  created_at timestamptz not null default now(),
  unique (event_date, start_time)
);

create table event_slot (
  event_id uuid not null references event(id) on delete cascade,
  position_id uuid not null references position(id) on delete restrict,
  quantity integer not null check (quantity >= 0),
  rate integer check (rate >= 0),
  primary key (event_id, position_id)
);

create table signup (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references worker(id) on delete cascade,
  event_id uuid not null references event(id) on delete cascade,
  status signup_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (worker_id, event_id)
);

create table assignment (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references worker(id) on delete cascade,
  event_id uuid not null references event(id) on delete cascade,
  -- NULL — человек набран на событие, но ещё не расставлен по должности
  position_id uuid references position(id) on delete restrict,
  rate integer check (rate >= 0),
  cancel_requested_at timestamptz,
  created_at timestamptz not null default now(),
  unique (worker_id, event_id)
);

create table manager_session (
  token_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index on assignment (event_id);
create index on assignment (worker_id);
create index on signup (event_id);
create index on event (event_date);

insert into position (name, sort_order, default_quantity) values
  ('АДМИН', 1, 1), ('ЗАЛ', 2, 1), ('ВХОД В ЗАЛ', 3, 1), ('БИЛЕТЫ', 4, 3),
  ('БАЛКОН', 5, 1), ('ВХОД', 6, 1), ('КАССА', 7, 1);

-- Роль приложения — кластерная, создаётся один раз. Право входа и пароль
-- выдаются вне миграций: локально supabase/seed.sql, на бою вручную.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end
$$;

-- Владелец таблиц должен уметь `set role app_user` — так тесты проверяют RLS.
do $$
begin
  execute format('grant app_user to %I', current_user);
end
$$;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
