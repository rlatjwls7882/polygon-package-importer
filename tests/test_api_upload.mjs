import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PolygonAPI } from '../src/polygon/api.js';

test('file uploads preserve UTF-8 bytes and sign the original content', async () => {
  const fetch = globalThis.fetch, interval = PolygonAPI.minimumIntervalMs;
  PolygonAPI.minimumIntervalMs = 0;
  const api = new PolygonAPI('TESTKEY', 'TESTSECRET');
  const content = '한국어 Україна і 😀 &+=%\nnext\r\nlast\n';
  try {
    for (const method of ['saveFile', 'saveSolution']) {
      globalThis.fetch = async (url, options) => {
        // Decode the actual HTTP representation, not just the FormData object.
        const request = new Request(url, options);
        assert.match(request.headers.get('content-type'), /^multipart\/form-data; boundary=/);
        const form = await request.formData(), file = form.get('file');
        assert(file instanceof Blob);
        assert.equal(file.name, 'source.cpp');
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(content));
        const signature = form.get('apiSig'), prefix = signature.slice(0, 6);
        const entries = await Promise.all([...form].filter(([key]) => key !== 'apiSig')
          .map(async ([key, value]) => [key, value instanceof Blob ? await value.text() : value]));
        entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        const canonical = prefix + '/problem.' + method + '?' +
          entries.map(([key, value]) => key + '=' + value).join('&') + '#TESTSECRET';
        assert.equal(signature, prefix + createHash('sha512').update(canonical).digest('hex'));
        return new Response('{"status":"OK","result":{}}');
      };
      await api.problem(method, 42, {name:'source.cpp', file:content, sourceType:'cpp.g++17'});
    }
    globalThis.fetch = async (url, options) => {
      assert(options.body instanceof URLSearchParams);
      assert.equal(options.body.has('file'), false);
      return new Response('{"status":"OK","result":{}}');
    };
    await api.problem('saveSolution', 42, {name:'source.cpp', tag:'MA'});
  } finally {
    api.dispose(); globalThis.fetch = fetch; PolygonAPI.minimumIntervalMs = interval;
  }
});
