import { describe, it, expect } from 'vitest';
import { LOGIN_PAGES, loginTarget } from '@/lib/auth/loginTarget';

describe('куда вести после входа из бота (`to`)', () => {
  it('страницы из белого списка — как есть', () => {
    expect(LOGIN_PAGES).toEqual(['/shifts', '/available', '/earnings', '/notifications']);
    for (const page of LOGIN_PAGES) expect(loginTarget(page)).toBe(page);
  });

  it('«Заработок» за месяц — только с правильным месяцем', () => {
    expect(loginTarget('/earnings?month=2099-07')).toBe('/earnings?month=2099-07');
    for (const bad of ['/earnings?month=2099-13', '/earnings?month=2099-7', '/earnings?month=2099-07&x=1',
      '/earnings?x=1', '/shifts?month=2099-07', '/earnings?month=2099-07#x']) {
      expect(loginTarget(bad), bad).toBe('/shifts');
    }
  });

  it('всё прочее — /shifts: никаких открытых редиректов', () => {
    for (const bad of [
      null, undefined, '', 'shifts', '/', '/month', '/workers', '/shifts/', '/Shifts', ' /shifts', '/shifts ',
      '//evil.example', '///evil.example', '/\\evil.example', '\\\\evil.example', 'https://evil.example/shifts',
      'javascript:alert(1)', '/shifts/../month', '/%2e%2e/month', '/shifts?x=1', '/shifts#x', '/available\n',
    ]) {
      expect(loginTarget(bad), String(bad)).toBe('/shifts');
    }
  });
});
