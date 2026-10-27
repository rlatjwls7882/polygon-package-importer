import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createMockI18n } from './mock-i18n.mjs';
import { localizePage, t } from '../i18n.js';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const en = JSON.parse(read('_locales/en/messages.json'));
const ko = JSON.parse(read('_locales/ko/messages.json'));
assert.deepEqual(Object.keys(en), Object.keys(ko));

const used = new Set();
const sourceFiles = readdirSync(root).filter(name => name.endsWith('.js'));
for (const filename of sourceFiles) {
  const source = read(filename);
  assert(!/[가-힣]/.test(source), 'Unlocalized text in ' + filename);
  for (const m of source.matchAll(/\bt\(['"]([^'"]+)['"]/g)) used.add(m[1]);
}
const html = read('popup.html');
assert(!/[가-힣]/.test(html), 'Unlocalized popup HTML');
for (const m of html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)) used.add(m[1]);
const manifest = JSON.parse(read('manifest.json'));
assert.equal(manifest.default_locale, 'en');
for (const value of [manifest.name, manifest.description, manifest.action.default_title]) {
  const match = /^__MSG_([^_]+(?:_[^_]+)*)__$/i.exec(value);
  assert(match, 'Unlocalized manifest field: ' + value);
  used.add(match[1]);
}
const placeholders = text => [...new Set((text.match(/\$[1-9]/g) || []))].sort();
for (const [key, entry] of Object.entries(en)) {
  assert(entry.message, 'Empty English translation: ' + key);
  assert(ko[key]?.message, 'Missing Korean translation: ' + key);
  assert(!/[가-힣]/.test(entry.message), 'Korean text in English message: ' + key);
  assert.deepEqual(placeholders(entry.message), placeholders(ko[key].message),
    'Substitution mismatch in ' + key);
}
for (const key of used) {
  assert(en[key]?.message && ko[key]?.message, 'Missing localization key: ' + key);
}
assert(used.size > 200, 'Expected all runtime diagnostics to be localized');
assert.deepEqual(new Set(Object.keys(en)), used, 'Remove unused localization keys');

const label = { dataset:{i18n:'upload'}, textContent:'' };
const section = {dataset:{i18nAriaLabel:'uploadSection'},setAttribute(name,value){this[name]=value;}};
globalThis.document = {
  documentElement:{lang:''},
  querySelectorAll(selector) {
    return selector==='[data-i18n]' ? [label] :
      selector==='[data-i18n-aria-label]' ? [section] : [];
  }
};
for (const [locale,language,expected] of [
  ['ko','ko','Polygon에 업로드'],
  ['en','en','Upload to Polygon'],
  ['fr','en','Upload to Polygon']
]) {
  globalThis.chrome={i18n:createMockI18n(locale)};
  localizePage();
  assert.equal(document.documentElement.lang,language);
  assert.equal(label.textContent,expected);
  assert.equal(section['aria-label'],createMockI18n(locale).getMessage('uploadSection'));
}
assert.equal(t('offscreenDoneProblemChangesSkipped',42,3,2),'Done · problem #42 · 3 changes · 2 skipped');
globalThis.chrome={i18n:createMockI18n('ko')};
assert(t('offscreenDoneProblemChangesSkipped',42,3,2).includes('문제 #42'));
console.log('PASS: locales, manifest, HTML, runtime messages, substitutions and fallback language');
