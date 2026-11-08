import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { createMockI18n } from './helpers/i18n.mjs';

for (const locale of ['en', 'ko']) test(`compiler-specific grader filters are rejected before network requests (${locale})`, async () => {
  const previous = chrome.i18n;
  chrome.i18n = createMockI18n(locale);
  try {
    for (const selector of ['cpp.g++20', 'cpp.g++23', 'cpp.g++17',
      'cpp.gcc13-64-winlibs-g++20', 'cpp.gcc14-64-msys2-g++23', 'cpp.gcc*', 'java.11', '*',
      'cpp.*;python.*', 'cpp.*:python.*', 'c.*', 'pascal.*', 'java.*']) {
      const f = fixture({grader:true, mutate({root}) {
        root.children.find(node => node.tag === 'files').children.find(node => node.tag === 'resources')
          .children[0].attributes['for-types'] = selector;
      }});
      const mock = createPolygon();
      await assert.rejects(() => f.upload(mock, 'replace'), error =>
        error.message.includes('files/grader.cpp') && error.message.includes(selector));
      assert.equal(mock.calls.length, 0);
    }
  } finally { chrome.i18n = previous; }
});

test('grader language groups stay separate from resolved source compiler IDs', async () => {
  const f = fixture({grader:true}), mock = createPolygon();
  await f.upload(mock);
  assert.equal(mock.state.solutions.get('main.cpp').sourceType, 'cpp.gcc13-64-winlibs-g++20');
  assert.equal(mock.state.fileMetadata.resource.get('grader.cpp').resourceAdvancedProperties.forTypes, 'cpp.*');
  const start = mock.calls.length;
  await f.upload(mock, 'replace');
  assert(!mock.calls.slice(start).some(call => call.method === 'saveFile'));
});

test('the Python group is preserved and duplicate identical groups do not widen it', async () => {
  const f = fixture({grader:true, mutate({root}) {
    root.children.find(node => node.tag === 'files').children.find(node => node.tag === 'resources')
      .children[0].attributes['for-types'] = 'python.*:python.*';
  }}), mock = createPolygon();
  await f.upload(mock);
  assert.equal(mock.state.fileMetadata.resource.get('grader.cpp').resourceAdvancedProperties.forTypes, 'python.*');
});
