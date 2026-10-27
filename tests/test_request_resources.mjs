import { getEventListeners } from 'node:events';
import { abortableDelay } from '../src/polygon/request-session.js';
import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolygonAPI } from '../src/polygon/api.js';
import * as responses from '../src/polygon/response.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('disposing during rate-limit backoff releases queued requests without waiting for the delay',async()=>{
  const original=PolygonAPI.sleep,interval=PolygonAPI.minimumIntervalMs,fetch=globalThis.fetch;
  let release,entered,requests=0,settled=0;
  const waiting=new Promise(resolve=>entered=resolve);
  PolygonAPI.minimumIntervalMs=0;
  PolygonAPI.sleep=()=>{entered();return new Promise(resolve=>release=resolve);};
  globalThis.fetch=async()=>{requests++;return new Response('{"status":"OK"}');};
  const api=new PolygonAPI('KEY','SECRET');api._cooldownUntil=Date.now()+60000;
  const jobs=Array.from({length:40},()=>api.call('problem.info').then(()=>{settled++;return null;},e=>{settled++;return e;}));
  try {
    await waiting;api.dispose();await tick();await tick();
    assert.equal(settled,40,'Disposed calls are still retained behind a sleeping queue');
    assert((await Promise.all(jobs)).every(error=>error?.name==='AbortError'));
    assert.equal(requests,0);
  } finally {release?.();await Promise.all(jobs);api.dispose();PolygonAPI.sleep=original;PolygonAPI.minimumIntervalMs=interval;globalThis.fetch=fetch;}
});

test('API JSON and raw bodies have actual streaming limits and are not retried on oversize',async()=>{
  const fetch=globalThis.fetch,interval=PolygonAPI.minimumIntervalMs;PolygonAPI.minimumIntervalMs=0;
  try {
    for (const raw of [false,true]) {
      let count=0,cancelled=0,delivered=0;
      const payload=new TextEncoder().encode(raw?'x'.repeat(128):JSON.stringify({status:'OK',result:'x'.repeat(128)}));
      globalThis.fetch=async()=>{count++;return new Response(new ReadableStream({
        pull(controller){if(delivered===payload.length){controller.close();return;}const end=Math.min(payload.length,delivered+8);controller.enqueue(payload.slice(delivered,end));delivered=end;},
        cancel(){cancelled++;}
      }));};
      const api=new PolygonAPI('KEY','SECRET',{jsonBytes:32,rawBytes:32});
      try {await assert.rejects(()=>api.call('problem.viewFile',{}, {raw}));assert.equal(count,1);assert.equal(cancelled,1);assert(delivered<=48);}
      finally {api.dispose();}
    }
  } finally {globalThis.fetch=fetch;PolygonAPI.minimumIntervalMs=interval;}
});

test('streamed text decoding preserves split UTF-8, empty bodies and BOM semantics',async()=>{
  assert.equal(typeof responses.readText,'function');
  const text='가나다 😀\r\n',bytes=new TextEncoder().encode('\ufeff'+text);
  const response=new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}}));
  assert.equal(await responses.readText(response,100,'too large'),text);
  assert.equal(await responses.readText(new Response(null),4,'too large'),'');
});

test('oversize Content-Length cancels text bodies before downloading them',async()=>{
  assert.equal(typeof responses.readText,'function');let cancelled=0,pulls=0;
  const response=new Response(new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(4));},cancel(){cancelled++;}}),{headers:{'content-length':'100000'}});
  await assert.rejects(()=>responses.readText(response,16,'too large'),/too large/);
  assert.equal(cancelled,1);assert(pulls<=1);
});

test('normal and aborted delays release their timer and abort listener',async()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,timers=new Set();
 globalThis.setTimeout=(fn,ms)=>{const id=originalSet(fn,ms);timers.add(id);return id;};
 globalThis.clearTimeout=id=>{timers.delete(id);originalClear(id);};
 try {
   const completed=new AbortController();await abortableDelay(1,completed.signal);
   assert.equal(timers.size,0);assert.equal(getEventListeners(completed.signal,'abort').length,0);
   const cancelled=new AbortController();const waiting=abortableDelay(60000,cancelled.signal);
   cancelled.abort();await assert.rejects(()=>waiting,{name:'AbortError'});
   assert.equal(timers.size,0);assert.equal(getEventListeners(cancelled.signal,'abort').length,0);
 } finally {for(const timer of timers)originalClear(timer);globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
test('text decode errors, malformed JSON and over-limit error envelopes leave no response timers',async()=>{
 const fetch=globalThis.fetch,interval=PolygonAPI.minimumIntervalMs;PolygonAPI.minimumIntervalMs=0;
 try {
   for(const mode of ['malformed','stream-error','large-error']) {
     const api=new PolygonAPI('KEY','SECRET',{errorBytes:16});let calls=0,cancelled=0;
     globalThis.fetch=async()=>{calls++;
       if(mode==='malformed')return new Response('{not-json');
       if(mode==='large-error')return new Response('x'.repeat(64),{status:500});
       return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([123]));c.error(new Error('read failed'));},cancel(){cancelled++;}}));
     };
     await assert.rejects(()=>api.call('problem.saveTest'));assert.equal(calls,1);
     assert.equal(api.session.requests.size,0);assert.equal(api.session.responses.size,0);api.dispose();
   }
 } finally {globalThis.fetch=fetch;PolygonAPI.minimumIntervalMs=interval;}
});
