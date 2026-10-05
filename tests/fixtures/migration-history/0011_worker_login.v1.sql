-- Вход работника из Telegram-бота: одноразовые коды входа и сессии работника
-- (спецификация docs/superpowers/specs/2026-10-03-bot-login-design.md).
-- Модель — как у telegram_link_code (0007/0008): в базе только sha256 в hex, сроки — по часам базы,
-- владелец кода — из личности сессии, погашение — только из сессии без личности.

create table worker_login_code (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  worker_id uuid not null references worker(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index worker_login_code_worker on worker_login_code (worker_id);

-- Сессия работника по образцу manager_session: cookie `worker_session` хранит токен, здесь — его хеш.
create table worker_session (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  worker_id uuid not null references worker(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index worker_session_worker on worker_session (worker_id);

alter table worker_login_code enable row level security;
alter table worker_session enable row level security;
-- Грантов app_user нет: коды и сессии выдаёт, проверяет и гасит только функции ниже.
create policy worker_login_code_none on worker_login_code for select using (false);
create policy worker_session_none on worker_session for select using (false);
revoke all on worker_login_code, worker_session from public;

-- Код входа: владелец — из личности сессии (работник, не менеджер), только действующий работник.
-- Не чаще раза в 30 секунд на работника (false — рано; прежний код остаётся). Новый код гасит прежние
-- коды работника; заодно убираются чужие коды, истёкшие больше суток назад. Блокировка по работнику
-- выстраивает одновременные выдачи: второй запрос видит код первого и получает false.
create or replace function issue_worker_login_code(p_code_hash text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid := current_worker_id();
begin
  if v_worker is null or is_manager() then
    raise exception 'permission denied: код входа выдаётся только работнику' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtext('worker_login_code:' || v_worker::text));
  if not exists (select 1 from worker where id = v_worker and status = 'active') then
    raise exception 'permission denied: работник в архиве' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from worker_login_code
             where worker_id = v_worker and created_at > clock_timestamp() - interval '30 seconds') then
    return false; -- = LOGIN_CODE_EVERY_SECONDS (src/lib/auth/workerSession.ts)
  end if;
  delete from worker_login_code where worker_id = v_worker or expires_at < now() - interval '1 day';
  insert into worker_login_code (code_hash, worker_id, created_at, expires_at)
  values (p_code_hash, v_worker, clock_timestamp(), clock_timestamp() + interval '15 minutes'); -- = LOGIN_CODE_MINUTES
  return true;
end
$$;

-- Вход по коду: только из сессии без личности (маршрут /tg/[code]); код существует, не истёк,
-- не использован, работник действует → код помечается использованным и создаётся сессия на год —
-- в одной транзакции. Одновременные входы по одному коду: update блокирует строку, второй её не находит.
-- У работника остаются 20 последних сессий; его истёкшие удаляются.
create or replace function redeem_worker_login_code(p_code_hash text, p_session_hash text) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_worker uuid;
begin
  if current_worker_id() is not null or is_manager() then
    return false;
  end if;
  update worker_login_code set used_at = clock_timestamp()
  where code_hash = p_code_hash and used_at is null and expires_at > clock_timestamp()
  returning worker_id into v_worker;
  if not found then
    return false;
  end if;
  if not exists (select 1 from worker where id = v_worker and status = 'active') then
    return false;
  end if;
  insert into worker_session (token_hash, worker_id, expires_at)
  values (p_session_hash, v_worker, clock_timestamp() + interval '1 year');
  delete from worker_session where worker_id = v_worker and (expires_at < now() or token_hash not in (
    select token_hash from worker_session where worker_id = v_worker order by created_at desc limit 20));
  return true;
end
$$;

-- Поиск работника по сессии без входа — как worker_by_token: строго по хешу, только действующий.
create or replace function worker_by_session(p_token_hash text) returns table (id uuid, full_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.full_name from worker_session s join worker w on w.id = s.worker_id
  where s.token_hash = p_token_hash and s.expires_at > now() and w.status = 'active'
$$;

-- Закрыть свою сессию (вход менеджера или по личной ссылке в этом браузере): знает токен — его сессия.
create or replace function end_worker_session(p_token_hash text) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  delete from worker_session where token_hash = p_token_hash
$$;

-- Перевыпуск личной ссылки и архив: все сессии и невыданные коды работника — только менеджер.
create or replace function end_worker_sessions(p_worker uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not is_manager() then
    raise exception 'permission denied: сессии работника закрывает только менеджер' using errcode = 'insufficient_privilege';
  end if;
  delete from worker_session where worker_id = p_worker;
  delete from worker_login_code where worker_id = p_worker;
end
$$;

revoke all on function issue_worker_login_code(text), redeem_worker_login_code(text, text),
  worker_by_session(text), end_worker_session(text), end_worker_sessions(uuid) from public;
grant execute on function issue_worker_login_code(text), redeem_worker_login_code(text, text),
  worker_by_session(text), end_worker_session(text), end_worker_sessions(uuid) to app_user;

-- Supabase открывает public через REST ролям anon и authenticated (см. 0002_rls.sql): закрываем и новые объекты.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on worker_login_code, worker_session from anon, authenticated;
    revoke all on function issue_worker_login_code(text), redeem_worker_login_code(text, text),
      worker_by_session(text), end_worker_session(text), end_worker_sessions(uuid)
      from anon, authenticated;
  end if;
end $$;
