import { describe, expect, it } from 'vitest';
import { verifyInitData, WEBAPP_MAX_AGE_SECONDS, WEBAPP_FUTURE_SKEW_SECONDS } from '@/lib/telegram/webApp';
import { signInitData, tgUser, WEBAPP_TEST_TOKEN } from './webAppFixtures';

/** Проверка initData Mini App по спецификации Telegram, без сети: тестовый вектор — signInitData. */
const TOKEN = WEBAPP_TEST_TOKEN;
const NOW = 1_900_000_000;
const user = tgUser;
const base = (over: Record<string, string> = {}) => ({
  query_id: 'AAH', user: user(101), auth_date: String(NOW - 60), signature: 'sig', ...over,
});

describe('verifyInitData', () => {
  it('известный вектор (посчитан отдельно, Python hmac): порядок ключа и сообщения как в спецификации', () => {
    const data = new URLSearchParams({
      query_id: 'AAH', user: '{"id":101,"first_name":"Ян"}', auth_date: '1899999940',
      hash: 'c9861e040490bad4d4eef1cb5d7fb91862007d7b54712fbff449a0b412254fef',
    }).toString();
    expect(verifyInitData(data, TOKEN, NOW)).toMatchObject({ ok: true, auth: { userId: 101, authDate: 1899999940 } });
  });

  it('подпись верна — id пользователя, время и hash', () => {
    const data = signInitData(base());
    const hash = new URLSearchParams(data).get('hash');
    expect(verifyInitData(data, TOKEN, NOW)).toEqual({ ok: true, auth: { userId: 101, authDate: NOW - 60, hash } });
  });

  it('изменённое поле, чужой ключ бота, подделанный hash — signature', () => {
    const data = signInitData(base());
    const tampered = new URLSearchParams(data);
    tampered.set('user', user(102));
    expect(verifyInitData(tampered.toString(), TOKEN, NOW)).toEqual({ ok: false, reason: 'signature' });
    expect(verifyInitData(data, '654321:other', NOW)).toEqual({ ok: false, reason: 'signature' });
    const forged = new URLSearchParams(data);
    forged.set('hash', '0'.repeat(64));
    expect(verifyInitData(forged.toString(), TOKEN, NOW)).toEqual({ ok: false, reason: 'signature' });
    const extra = new URLSearchParams(data);
    extra.set('chat_type', 'private');
    expect(verifyInitData(extra.toString(), TOKEN, NOW)).toEqual({ ok: false, reason: 'signature' });
  });

  it('initData принимаются не дольше часа (L5 полного ревью безопасности)', () => {
    expect(WEBAPP_MAX_AGE_SECONDS).toBe(60 * 60);
    expect(verifyInitData(signInitData(base({ auth_date: String(NOW - 2 * 60 * 60) })), TOKEN, NOW))
      .toEqual({ ok: false, reason: 'expired' });
  });

  it(`старше ${WEBAPP_MAX_AGE_SECONDS} с — expired; из будущего дальше ${WEBAPP_FUTURE_SKEW_SECONDS} с — future`, () => {
    expect(verifyInitData(signInitData(base({ auth_date: String(NOW - WEBAPP_MAX_AGE_SECONDS - 1) })), TOKEN, NOW))
      .toEqual({ ok: false, reason: 'expired' });
    expect(verifyInitData(signInitData(base({ auth_date: String(NOW - WEBAPP_MAX_AGE_SECONDS) })), TOKEN, NOW).ok).toBe(true);
    expect(verifyInitData(signInitData(base({ auth_date: String(NOW + WEBAPP_FUTURE_SKEW_SECONDS + 1) })), TOKEN, NOW))
      .toEqual({ ok: false, reason: 'future' });
    expect(verifyInitData(signInitData(base({ auth_date: String(NOW + WEBAPP_FUTURE_SKEW_SECONDS) })), TOKEN, NOW).ok).toBe(true);
  });

  it('не по форме — malformed: нет hash, hash не hex, повтор ключа, нет auth_date, слишком длинно, пусто', () => {
    const data = signInitData(base());
    const noHash = new URLSearchParams(data);
    noHash.delete('hash');
    for (const bad of [
      '', noHash.toString(), data.replace(/hash=[0-9a-f]+/, 'hash=XYZ'), `${data}&user=${encodeURIComponent(user(1))}`,
      signInitData({ query_id: 'AAH', user: user(101) }), signInitData(base({ auth_date: '12x' })), `${data}&pad=${'x'.repeat(5000)}`,
    ]) {
      expect(verifyInitData(bad, TOKEN, NOW)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('подписанные данные без пользователя или с неверным id — no_user', () => {
    expect(verifyInitData(signInitData({ auth_date: String(NOW) }), TOKEN, NOW)).toEqual({ ok: false, reason: 'no_user' });
    for (const u of ['{"id":-5}', '{"id":"101"}', '{"id":1.5}', 'не json', '{}']) {
      expect(verifyInitData(signInitData(base({ user: u })), TOKEN, NOW)).toEqual({ ok: false, reason: 'no_user' });
    }
  });
});
