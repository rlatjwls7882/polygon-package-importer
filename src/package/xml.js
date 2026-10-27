import { t } from '../i18n.js';
export const CHILD = (el, tag) => el ? [...el.children].find(x => x.localName === tag) : null;
export const CHILDREN = (el, tag) => el ? [...el.children].filter(x => x.localName === tag) : [];
export const TEXT = (el, tag) => (CHILD(el, tag)?.textContent || '').trim();
export const ATTR = (el, name, fallback = '') => el?.getAttribute(name) ?? fallback;
export function resolveXmlText(xml) {
  // Do not allow external entities. DOMParser never loads external resources, but refuse DTD.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw Error(t('modelProblemXmlMustNotContainDoctypeOr'));
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'problem') throw Error(t('modelInvalidPolygonProblemXml'));
  return doc.documentElement;
}

export function KIND_DESC(assets, name) { return name === 'validator' ? CHILD(CHILD(assets, 'validators'), 'validator') : CHILD(assets, name); }
