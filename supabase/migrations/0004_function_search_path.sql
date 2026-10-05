-- Аудит Supabase (function_search_path_mutable): функции из политик RLS
-- должны иметь фиксированный search_path. Тела не меняются.
alter function current_worker_id() set search_path = pg_catalog, pg_temp;
alter function is_manager() set search_path = pg_catalog, pg_temp;
