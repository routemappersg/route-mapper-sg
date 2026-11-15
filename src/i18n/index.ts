import en from './locales/en.json';
import zh from './locales/zh.json';
import ms from './locales/ms.json';

export type Locale = 'en' | 'zh' | 'ms';
export const LOCALES: Locale[] = ['en', 'zh', 'ms'];
// Tamil (ta) is added after native-speaker review.

type Dict = Record<string, string>;
const dictionaries: Record<Locale, Dict> = { en, zh, ms };

let locale: Locale = 'en';

export function setLocale(l: Locale): void {
  locale = l;
}

export function getLocale(): Locale {
  return locale;
}

/** Translate a key; falls back to English, then to the key itself. {name} placeholders are filled from params. */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const raw = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

/** Best supported locale for a browser language tag such as "zh-SG" or "ms-MY". */
export function detectLocale(tag: string | undefined): Locale {
  const base = (tag ?? 'en').toLowerCase().split('-')[0];
  return (LOCALES as string[]).includes(base ?? '') ? (base as Locale) : 'en';
}
