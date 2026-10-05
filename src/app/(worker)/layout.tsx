import { requireWorker } from '@/lib/auth/session';

/**
 * Каркас (приветствие, заголовок, нижняя панель) рисует каждая страница через
 * WorkerShell — заголовок у каждой свой. Проверка входа здесь — только запас:
 * страницы и действия проверяют права сами (tests/access.test.ts).
 */
export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
  await requireWorker();

  return <>{children}</>;
}
