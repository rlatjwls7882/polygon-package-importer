let messages = null;

// Offscreen documents expose chrome.runtime, but not chrome.i18n.
export async function loadMessages(locale) {
  if (globalThis.chrome?.i18n?.getMessage) return;
  const language = /^ko(?:[-_]|$)/i.test(String(locale)) ? 'ko' : 'en';
  const response = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`));
  if (!response.ok) throw Error('Could not load extension messages: HTTP ' + response.status);
  messages = await response.json();
}

export function t(key, ...values) {
  const args = values.map(String);
  if (globalThis.chrome?.i18n?.getMessage)
    return chrome.i18n.getMessage(key, args) || key;
  const message = messages?.[key]?.message || key;
  return message.replace(/\$([1-9])/g, (_, index) => args[Number(index) - 1] ?? '');
}

export function localizePage() {
  const locale = chrome.i18n.getMessage('@@ui_locale');
  document.documentElement.lang = locale.startsWith('ko') ? 'ko' : 'en';
  for (const element of document.querySelectorAll('[data-i18n]'))
    element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-aria-label]'))
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
}
