-- Расширение без изменения прежних ставок, мест и назначений.
alter table event_type_slot add column rate integer check (rate between 0 and 1000000);
alter table event_slot add column type_rate integer check (type_rate between 0 and 1000000);

-- Все пути создания места, включая импорт и применение состава, получают
-- снимок ставки вида. Ручная ставка rate хранится отдельно и имеет приоритет.
create function inherit_slot_type_rate() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  select t.rate into new.type_rate
    from event e join event_type_slot t on t.event_type_id=e.event_type_id
    where e.id=new.event_id and t.position_id=new.position_id
      and e.event_date>=current_date;
  return new;
end
$$;
create trigger event_slot_type_rate before insert on event_slot
  for each row execute function inherit_slot_type_rate();
revoke all on function inherit_slot_type_rate() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then
    revoke all on function inherit_slot_type_rate() from anon, authenticated;
  end if;
end $$;
