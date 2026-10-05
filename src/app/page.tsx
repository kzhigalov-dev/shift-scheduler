import { redirect } from 'next/navigation';
import { isManager, getCurrentWorker } from '@/lib/auth/session';

export default async function Home() {
  if (await isManager()) redirect('/month');
  if (await getCurrentWorker()) redirect('/shifts');
  redirect('/login');
}
