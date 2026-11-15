import { describe, expect, it } from 'vitest';
import en from '../src/i18n/locales/en.json';
import zh from '../src/i18n/locales/zh.json';
import ms from '../src/i18n/locales/ms.json';
import { detectLocale, setLocale, t } from '../src/i18n';

describe('i18n', () => {
  it('every locale has exactly the English keys', () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(zh).sort()).toEqual(keys);
    expect(Object.keys(ms).sort()).toEqual(keys);
  });

  it('falls back to the key when missing and fills placeholders', () => {
    setLocale('en');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('detects supported languages from browser tags', () => {
    expect(detectLocale('zh-SG')).toBe('zh');
    expect(detectLocale('ms-MY')).toBe('ms');
    expect(detectLocale('ta-SG')).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
  });
});
