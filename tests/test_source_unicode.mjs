import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, n } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { createMockI18n } from './helpers/i18n.mjs';

for (const locale of ['en', 'ko']) for (const path of ['files/val.cpp', 'solutions/main.cpp'])
  test(`unsupported source Unicode stops before contacting Polygon: ${locale}, ${path}`, async () => {
    const previous = chrome.i18n;
    chrome.i18n = createMockI18n(locale);
    try {
      for (const character of ['\u{10000}', '😀', '𠀀', '\u{10ffff}']) {
        const f = fixture({mutate({contents}) { contents[path] += '\n// ' + character; }});
        const mock = createPolygon();
        await assert.rejects(() => f.upload(mock, 'replace'), error =>
          error.message.includes(chrome.i18n.getMessage('modelUnsupportedSourceUnicode', [path])));
        assert.equal(mock.calls.length, 0);
      }
    } finally { chrome.i18n = previous; }
  });

test('BMP source text and supplementary resource/test text remain supported', async () => {
  const f = fixture({mutate({root, contents}) {
    contents['files/val.cpp'] += '\n// 한국어 Україна \uffff';
    contents['solutions/main.cpp'] += '\n// 한국어 Україна \uffff';
    root.children.find(node => node.tag === 'files').children.find(node => node.tag === 'resources')
      .children.push(n('file', {path:'files/unicode.txt'}));
    contents['files/unicode.txt'] = '😀 𠀀\n';
    contents['tests/02'] = '😀 𠀀\n';
  }});
  const mock = createPolygon();
  await f.upload(mock);
  assert.equal(mock.state.files.resource.get('unicode.txt'), '😀 𠀀\n');
  assert.equal(mock.state.tests.get(2).input, '😀 𠀀\n');
});
