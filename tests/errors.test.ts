import { describe, it, expect, vi, afterEach } from 'vitest';
import postgres from 'postgres';
import { UserError, userMessage } from '@/lib/errors';

function fakePostgresError(message: string, code: string): unknown {
  const error = Object.assign(new Error(message), { code });
  Object.setPrototypeOf(error, postgres.PostgresError.prototype);
  return error;
}

describe('UserError', () => {
  it('это Error с собственным именем', () => {
    const error = new UserError('Неверная дата');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UserError');
    expect(error.message).toBe('Неверная дата');
  });
});

describe('userMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('UserError — отдаёт её текст, в лог не пишет', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(userMessage(new UserError('Неверная дата'))).toBe('Неверная дата');
    expect(spy).not.toHaveBeenCalled();
  });

  it('обычная ошибка — общий текст, её сообщение не утекает, но логируется', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const message = userMessage(new Error('relation "event" does not exist'));
    expect(message).toBe('Не удалось выполнить действие — попробуйте ещё раз');
    expect(message).not.toMatch(/event/);
    expect(spy).toHaveBeenCalled();
  });

  it('ошибка Postgres — общий текст, SQL наружу не идёт', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pgError = fakePostgresError(
      'value "99999999999999999999" is out of range for type integer', '22003',
    );
    const message = userMessage(pgError);
    expect(message).toBe('Не удалось выполнить действие — попробуйте ещё раз');
    expect(message).not.toMatch(/integer/);
    expect(spy).toHaveBeenCalled();
  });

  it('можно задать свой fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(userMessage(new Error('boom'), 'Ошибка базы')).toBe('Ошибка базы');
  });

  it('не Error вовсе — тоже общий текст', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(userMessage('что-то странное')).toBe('Не удалось выполнить действие — попробуйте ещё раз');
  });
});
