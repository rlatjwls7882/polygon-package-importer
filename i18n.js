export function t(key, ...values) {
  return globalThis.chrome?.i18n?.getMessage(key, values.map(String)) || key;
}

export function localizePage() {
  const locale = chrome.i18n.getMessage('@@ui_locale');
  document.documentElement.lang = locale.startsWith('ko') ? 'ko' : 'en';
  for (const element of document.querySelectorAll('[data-i18n]'))
    element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-aria-label]'))
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
}
