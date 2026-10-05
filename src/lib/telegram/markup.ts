import type { Tx } from '@/db/client';
import { managerSignupKeyboard, MAX_POSITION_BUTTONS, type Keyboard } from './keyboards';

/** Должности мероприятия, где сейчас есть свободные места (`quantity` > назначено на должность), по порядку, не больше 6. */
export async function openPositions(tx: Tx, eventId: string): Promise<Array<{ id: string; name: string }>> {
  return tx<Array<{ id: string; name: string }>>`
    select p.id, p.name from event_slot s join position p on p.id = s.position_id
    where s.event_id = ${eventId}
      and s.quantity > (select count(*) from assignment a where a.event_id = s.event_id and a.position_id = s.position_id)
    order by p.sort_order, p.name limit ${MAX_POSITION_BUTTONS}`;
}

/** Кнопки к заявке: нужна ожидающая заявка этого работника на это мероприятие; её нет — без кнопок. */
export async function signupRequestMarkup(tx: Tx, eventId: string, workerId: string): Promise<Keyboard | null> {
  const [signup] = await tx<Array<{ id: string }>>`
    select id from signup where event_id = ${eventId} and worker_id = ${workerId} and status = 'pending'`;
  if (!signup) return null;
  return managerSignupKeyboard(signup.id, await openPositions(tx, eventId));
}
