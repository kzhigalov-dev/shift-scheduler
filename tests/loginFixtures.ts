import { testSql } from './setup';

/**
 * Код входа выдаётся только в подключённый чат работника (0013): тестам нужна привязка.
 * Чаты — положительные числа, разные у разных работников.
 */
const chats = new Map<string, number>();
let next = 7000;

export async function linkWorkerChat(workerId: string, chatId = ++next): Promise<number> {
  await testSql`insert into telegram_link (worker_id, chat_id) values (${workerId}, ${chatId})`;
  chats.set(workerId, chatId);
  return chatId;
}

/** Чат работника из linkWorkerChat; без привязки — 0 (такого чата нет, выдача отказывает). */
export const chatOf = (workerId: string): number => chats.get(workerId) ?? 0;
