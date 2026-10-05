import { requireManager } from '@/lib/auth/session';
import { ManagerShell } from '@/components/ManagerShell';

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  await requireManager();

  return <ManagerShell>{children}</ManagerShell>;
}
