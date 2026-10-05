import postgres from 'postgres';

/** Транзакция postgres.js. Все операции над базой принимают именно её. */
export type Tx = postgres.TransactionSql;

let pool: postgres.Sql | null = null;

/** Пул создаётся лениво: импорт модуля без DATABASE_URL не должен падать. */
function getPool(): postgres.Sql {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не задан');
  // prepare: false обязателен для пулера Supabase в режиме транзакций.
  // idle_timeout: простаивающие соединения закрываются через 20 с — на Vercel
  // экземпляр функции замораживают, и пулер Supabase не держит лишние.
  // connect_timeout: недоступная база — ошибка через 10 с, а не вечное ожидание.
  pool = postgres(url, {
    max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10, onnotice: () => {},
  });
  return pool;
}

type Identity = { workerId?: string; manager?: boolean };
type IsolationOptions = { isolation?: 'read committed' | 'repeatable read' };

async function inTransaction<T>(identity: Identity, fn: (tx: Tx) => Promise<T>, options: IsolationOptions = {}): Promise<T> {
  const result = await getPool().begin(`isolation level ${options.isolation ?? 'read committed'}`, async (tx) => {
    // Один запрос вместо трёх: до пулера Supabase каждый — отдельный круг.
    // Пустая строка — «личности нет»: политики читают nullif(…, '').
    await tx`
      select set_config('timezone', 'Europe/Moscow', true),
             set_config('app.is_manager', ${identity.manager ? 'true' : ''}, true),
             set_config('app.worker_id', ${identity.workerId ?? ''}, true)`;
    return fn(tx);
  });
  return result as T;
}

/** Без личности: доступны только функции security definer (вход по токену). */
export function withAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction({}, fn);
}

/** От лица работника: политики RLS смотрят на app.worker_id. */
export function withWorker<T>(workerId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction({ workerId }, fn);
}

/** От лица менеджера: политики RLS пропускают всё. */
export function withManager<T>(fn: (tx: Tx) => Promise<T>, options: IsolationOptions = {}): Promise<T> {
  return inTransaction({ manager: true }, fn, options);
}

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}
