import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolygonAPI } from '../src/polygon/api.js';

for (const contentType of ['text/plain', 'application/json'])
  test(`strict resource reads reject invalid UTF-8 without replacing bytes: ${contentType}`, async () => {
    const fetch = globalThis.fetch, interval = PolygonAPI.minimumIntervalMs;
    PolygonAPI.minimumIntervalMs = 0;
    const api = new PolygonAPI('TESTKEY', 'TESTSECRET');
    try {
      globalThis.fetch = async () => new Response(Uint8Array.of(255), {headers:{'content-type':contentType}});
      await assert.rejects(() => api.problem('viewFile', 42, {type:'resource', name:'grader.cpp'},
        {raw:true, strictText:true}), {name:'TypeError'});
      const source = '// 한국어 😀\n';
      globalThis.fetch = async () => new Response(source, {headers:{'content-type':contentType}});
      assert.equal(await api.problem('viewFile', 42, {type:'resource', name:'grader.cpp'},
        {raw:true, strictText:true}), source);
    } finally {
      api.dispose(); globalThis.fetch = fetch; PolygonAPI.minimumIntervalMs = interval;
    }
  });
