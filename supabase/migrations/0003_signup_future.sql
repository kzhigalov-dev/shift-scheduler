-- Защита в глубину: createSignup уже проверяет, что событие не в прошлом,
-- но RLS должна отбивать и прямую вставку в обход приложения. Менеджеру
-- по-прежнему можно всё — условие добавляется только для работника.
drop policy signup_create on signup;
create policy signup_create on signup for insert
  with check (
    is_manager() or (
      worker_id = current_worker_id() and status = 'pending'
      and exists (
        select 1 from event e where e.id = event_id
          and e.event_date >= (now() at time zone 'Europe/Moscow')::date
      )
    )
  );
