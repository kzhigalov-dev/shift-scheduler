import { createHash } from 'node:crypto';

/** Ключ бота — только из окружения; нигде не печатается. Без ключа бот «не настроен». */
export const botToken = (): string | null => process.env.TELEGRAM_BOT_TOKEN || null;
export const botUsername = (): string => process.env.TELEGRAM_BOT_USERNAME || 'DemoShiftsBot';
export const isTelegramConfigured = (): boolean => botToken() !== null;
/** Секрет вебхука производный от ключа: отдельная переменная не нужна. */
export const webhookSecret = (token: string): string => createHash('sha256').update(`webhook:${token}`).digest('hex');
export const deepLink = (code: string): string => `https://t.me/${botUsername()}?start=${code}`;
