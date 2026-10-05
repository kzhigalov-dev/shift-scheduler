-- Месяц: черновик или опубликован. Работник видит события, места, заявки
-- и назначения только опубликованных месяцев — это решает база, а не экран.
create type month_status as enum ('draft', 'published');

create table month (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status month_status not null default 'published',
  published_at timestamptz
);

alter table month enable row level security;
-- Без delete: приложение месяцы не удаляет, а удаление спрятало бы события от работников.
grant select, insert, update on month to app_user;

create policy month_read on month for select
  using (is_manager() or (current_worker_id() is not null and status = 'published'));
create policy month_manage on month for all
  using (is_manager()) with check (is_manager());

-- Все месяцы, где события уже есть, — опубликованы (так было до черновиков).
insert into month (month, status, published_at)
select distinct to_char(event_date, 'YYYY-MM'), 'published'::month_status, now() from event
on conflict (month) do nothing;

-- Приход: у существующих событий он взят из таблицы работников — «поправлен
-- вручную»; у новых по умолчанию автоматический.
alter table event add column arrive_manual boolean not null default true;
alter table event alter column arrive_manual set default false;
-- Исходное название из файла расписания: по нему событие узнаётся при
-- повторной загрузке. null — событие создано вручную.
alter table event add column source_title text;

-- Номер строки должности в таблице расстановки (с 0). null — первая свободная.
alter table assignment add column plan_row smallint check (plan_row >= 0);

-- Событие в месяце без записи — месяц сразу опубликован. Черновик не трогаем.
create or replace function ensure_event_month() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  insert into month (month, status, published_at)
  values (to_char(new.event_date, 'YYYY-MM'), 'published', now())
  on conflict (month) do nothing;
  return new;
end
$$;

create trigger event_month after insert or update of event_date on event
  for each row execute function ensure_event_month();

-- Опубликован ли месяц события. security definer: политика на event_slot,
-- signup и assignment не должна зависеть от RLS на event.
create or replace function event_published(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from event e
    join month m on m.month = to_char(e.event_date, 'YYYY-MM')
    where e.id = p_event_id and m.status = 'published'
  )
$$;

revoke execute on function event_published(uuid) from public;
grant execute on function event_published(uuid) to app_user;

drop policy event_read on event;
create policy event_read on event for select
  using (is_manager() or (current_worker_id() is not null and exists (
    select 1 from month m
    where m.month = to_char(event.event_date, 'YYYY-MM') and m.status = 'published'
  )));

drop policy slot_read on event_slot;
create policy slot_read on event_slot for select
  using (is_manager() or (current_worker_id() is not null and event_published(event_id)));

drop policy signup_read on signup;
create policy signup_read on signup for select
  using (is_manager() or (worker_id = current_worker_id() and event_published(event_id)));

drop policy signup_create on signup;
create policy signup_create on signup for insert
  with check (
    is_manager() or (
      worker_id = current_worker_id() and status = 'pending'
      and event_published(event_id)
      and exists (
        select 1 from event e where e.id = event_id
          and e.event_date >= (now() at time zone 'Europe/Moscow')::date
      )
    )
  );

drop policy assignment_read on assignment;
create policy assignment_read on assignment for select
  using (is_manager() or (worker_id = current_worker_id() and event_published(event_id)));

-- Отмена смены — security definer в обход RLS: условие публикации явно.
create or replace function request_cancel(p_event_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  update assignment
  set cancel_requested_at = now()
  where event_id = p_event_id
    and worker_id = current_worker_id()
    and cancel_requested_at is null
    and event_published(p_event_id)
    and exists (
      select 1 from event e where e.id = p_event_id and e.event_date >= (now() at time zone 'Europe/Moscow')::date
    );
  return found;
end
$$;
