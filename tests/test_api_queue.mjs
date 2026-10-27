import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolygonAPI } from '../src/polygon/api.js';

test('queued API calls wait for response parsing and rate-limit backoff',async()=>{
  const originalFetch=globalThis.fetch,originalSleep=PolygonAPI.sleep,originalNow=Date.now;
  const interval=PolygonAPI.minimumIntervalMs;
  let now=0,release,entered;
  const gate=new Promise(resolve=>release=resolve),atBody=new Promise(resolve=>entered=resolve),calls=[];
  Date.now=()=>now;PolygonAPI.minimumIntervalMs=0;PolygonAPI.sleep=async ms=>{now+=ms;};
  globalThis.fetch=async url=>{
    calls.push(url.split('/').pop());
    if(calls.length===1)return {status:200,ok:true,headers:new Headers(),text:async()=>{
      entered();await gate;return JSON.stringify({status:'FAILED',comment:'Call limit exceeded'});
    }};
    return new Response(JSON.stringify({status:'OK',result:{}}),{status:200});
  };
  try {
    const api=new PolygonAPI('KEY','SECRET');
    const first=api.call('problem.info');await atBody;
    const second=api.call('problem.files');
    await new Promise(resolve=>setImmediate(resolve));release();
    await Promise.all([first,second]);
    assert.deepEqual(calls,['problem.info','problem.info','problem.files']);
    assert(now>=4000);
  } finally {globalThis.fetch=originalFetch;PolygonAPI.sleep=originalSleep;PolygonAPI.minimumIntervalMs=interval;Date.now=originalNow;}
});
