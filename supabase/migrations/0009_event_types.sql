-- Справочник видов и независимые шаблоны состава. Старые места не меняются.
create table event_type (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  name_key text not null unique,
  sort_order integer not null,
  archived boolean not null default false,
  system_tag event_tag unique
);
create table event_type_slot (
  event_type_id uuid not null references event_type(id) on delete restrict,
  position_id uuid not null references position(id) on delete restrict,
  quantity integer not null check (quantity between 0 and 20),
  primary key (event_type_id, position_id)
);
alter table event_type enable row level security;
alter table event_type_slot enable row level security;
create policy type_read on event_type for select
  using (is_manager() or current_worker_id() is not null);
create policy type_manage on event_type for all
  using (is_manager()) with check (is_manager());
create policy type_slot_manage on event_type_slot for all
  using (is_manager()) with check (is_manager());
grant select on event_type to app_user;
grant insert (name, sort_order, archived), update (name, sort_order, archived) on event_type to app_user;
grant select, insert, update, delete on event_type_slot to app_user;

create function normalize_event_type() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if TG_OP = 'UPDATE' and new.system_tag is distinct from old.system_tag then
    raise exception 'Системная классификация вида неизменяема';
  end if;
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.name_key := replace(lower(new.name), 'ё', 'е');
  return new;
end
$$;
create trigger event_type_normalize before insert or update on event_type
  for each row execute function normalize_event_type();

insert into event_type(name, sort_order, system_tag) values
  ('обычное', 1, 'regular'), ('часовня', 2, 'chapel'), ('ночной', 3, 'night'),
  ('седер', 4, 'seder'), ('орган', 5, 'organ'), ('экскурсия', 6, 'excursion');
insert into event_type_slot(event_type_id, position_id, quantity)
  select t.id, p.id, p.default_quantity from event_type t cross join position p;
alter table event add column event_type_id uuid references event_type(id) on delete restrict;
update event e set event_type_id = t.id from event_type t where t.system_tag = e.tag;
alter table event alter column event_type_id set not null;
create index on event(event_type_id);

create function sync_event_type() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if TG_OP = 'INSERT' then
    if new.event_type_id is null then
      select id into new.event_type_id from event_type where system_tag = new.tag;
    end if;
  elsif new.event_type_id is not distinct from old.event_type_id
    and new.tag is distinct from old.tag then
    select id into new.event_type_id from event_type where system_tag = new.tag;
  end if;
  select coalesce(system_tag, 'regular'::event_tag) into new.tag
    from event_type where id = new.event_type_id;
  return new;
end
$$;
create trigger event_type_link before insert or update of tag, event_type_id on event
  for each row execute function sync_event_type();
-- Триггерные функции не предоставляют самостоятельного API.
revoke all on function normalize_event_type(), sync_event_type() from public;
