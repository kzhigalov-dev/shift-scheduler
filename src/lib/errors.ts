/** Ошибка, текст которой можно показать пользователю. Всё остальное — внутреннее. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/** Текст для экрана: у UserError — её текст, у остального — общий, сама ошибка — в лог. */
export function userMessage(error: unknown, fallback = 'Не удалось выполнить действие — попробуйте ещё раз'): string {
  if (error instanceof UserError) return error.message;
  console.error(error);
  return fallback;
}
