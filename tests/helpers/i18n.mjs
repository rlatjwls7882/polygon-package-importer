import { readFileSync } from 'node:fs';

const catalogs = Object.fromEntries(['ko', 'en'].map(locale => [
  locale, JSON.parse(readFileSync(new URL('../../_locales/' + locale + '/messages.json', import.meta.url), 'utf8'))
]));

export function createMockI18n(locale = 'ko') {
  return {
    getMessage(key, substitutions = []) {
      if (key === '@@ui_locale') return locale;
      const message = (catalogs[locale] || catalogs.en)[key]?.message || '';
      const args = Array.isArray(substitutions) ? substitutions : [substitutions];
      return message.replace(/\$([1-9])/g, (_, index) => String(args[Number(index) - 1] ?? ''));
    }
  };
}

globalThis.chrome ??= { i18n: createMockI18n() };
