-- Одновременные входы одного пользователя не должны обходить лимит пяти попыток в минуту.
-- Меняется только функция: существующие сессии и записи защиты от повтора сохраняются.
-- Повторное применение безопасно. Обратный переход — определение webapp_login из 0013,
-- без изменений таблиц; он возвращает прежнее поведение с незащищённым от гонки лимитом.
create or replace function webapp_login(
  p_init_hash text, p_user_id bigint, p_auth_date timestamptz, p_session_hash text, p_current_hash text
) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid;
begin
  if current_worker_id() is not null or is_manager() then
    return 'denied';
  end if;
  -- Блокировка живёт до конца транзакции, охватывая проверку лимита и запись попытки.
  -- Ключ отдельный для каждого пользователя; пространство имён не пересекается с другими задачами.
  -- Порядок: лимит пользователя → worker → telegram_link, как у остальных проверок доступа.
  perform pg_advisory_xact_lock(hashtextextended('telegram_webapp_login:' || p_user_id::text, 0));
  delete from telegram_webapp_login where expires_at < now();
  if (select count(*) from telegram_webapp_login
      where user_id = p_user_id and created_at > now() - interval '1 minute') >= 5 then
    return 'too_often';
  end if;
  -- Запись живёт весь срок, в который приложение принимает этот initData (сутки и 5 минут сдвига часов).
  insert into telegram_webapp_login (init_hash, user_id, expires_at)
  values (p_init_hash, p_user_id, greatest(p_auth_date, now()) + interval '1 day 5 minutes')
  on conflict (init_hash) do nothing;
  if not found then
    return 'replay';
  end if;
  select worker_id into v_worker from telegram_link where chat_id = p_user_id;
  if not found then
    return 'unlinked';
  end if;
  if v_worker is null then
    return 'manager';
  end if;
  perform 1 from worker where id = v_worker and status = 'active' for update;
  if not found then
    return 'archived';
  end if;
  -- Одновременное отключение ждёт этот вход, а затем его триггер закрывает и эту сессию.
  perform 1 from telegram_link where worker_id = v_worker and chat_id = p_user_id for share;
  if not found then
    return 'unlinked';
  end if;
  if exists (select 1 from worker_session where token_hash = p_current_hash and worker_id = v_worker
             and chat_id = p_user_id and expires_at > now()) then
    return 'kept';
  end if;
  insert into worker_session (token_hash, worker_id, chat_id, expires_at)
  values (p_session_hash, v_worker, p_user_id, clock_timestamp() + interval '1 year');
  delete from worker_session where worker_id = v_worker and (expires_at < now() or token_hash not in (
    select token_hash from worker_session where worker_id = v_worker order by created_at desc limit 20));
  return 'ok';
end
$$;

revoke all on function webapp_login(text, bigint, timestamptz, text, text) from public;
grant execute on function webapp_login(text, bigint, timestamptz, text, text) to app_user;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function webapp_login(text, bigint, timestamptz, text, text) from anon, authenticated;
  end if;
end $$;
