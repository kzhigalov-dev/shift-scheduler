-- Telegram: усиление после ревью.

-- Привязку чата создаёт только сессия без личности — вебхук, проверивший секрет Telegram.
-- Работник или менеджер, вызвавший функцию из своей сессии, не может привязать
-- произвольный chat_id своим же кодом; код при этом не гасится.
create or replace function link_telegram(p_code_hash text, p_chat_id bigint) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid;
begin
  if current_worker_id() is not null or is_manager() then
    return 'invalid';
  end if;
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
-- create or replace сохраняет права; повторяем явно, как требует AGENTS.md.
revoke execute on function link_telegram(text, bigint) from public;
grant execute on function link_telegram(text, bigint) to app_user;

-- Время постановки в очередь по часам базы: send_after теперь меняют аренда и отсрочка,
-- поэтому «свободное место не чаще раза в 6 часов» и «устарело за сутки» считаются от created_at.
alter table tg_outbox add column created_at timestamptz not null default now();
