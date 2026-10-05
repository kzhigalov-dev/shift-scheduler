-- Отдельные сведения о концерте: комментарий, смены и ставки сохраняются.
alter table event add column if not exists program text;
alter table event add column if not exists performers text;
alter table event add column if not exists concert_details_imported boolean not null default false;
