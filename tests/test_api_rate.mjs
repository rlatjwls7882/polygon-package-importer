import assert from 'node:assert/strict';
import { PolygonAPI } from '../api.js';

PolygonAPI.minimumIntervalMs=0;
const originalSleep=PolygonAPI.sleep;
const waits=[];
PolygonAPI.sleep=async ms=>{waits.push(ms);}; // no actual waiting in tests
const api=new PolygonAPI('TESTKEY','TESTSECRET');
const notifications=[];
api.onRateLimit=notice=>notifications.push(notice);

let requests=[];
globalThis.fetch=async (url, opts)=>{
  requests.push({url,opts});
  if(requests.length===1) return new Response(
    '<html><head><title>429 Too Many Requests</title></head></html>',
    {status:429,headers:{'content-type':'text/html','retry-after':'12'}}
  );
  return new Response(JSON.stringify({status:'OK',result:{id:7}}),
    {status:200,headers:{'content-type':'application/json'}});
};
const created=await api.call('problem.create',{name:'demo'});
assert.equal(created.id,7);
assert.equal(requests.length,2);
assert(waits.some(x=>x>11000 && x<=12000),'Retry-After must be honored');
assert.equal(notifications.length,1);
assert.equal(notifications[0].method,'problem.create');
const first=new URLSearchParams(requests[0].opts.body).get('apiSig');
const second=new URLSearchParams(requests[1].opts.body).get('apiSig');
assert.notEqual(first,second,'Each attempt must have a freshly generated API signature');
console.log('PASS: HTTP 429 HTML + Retry-After header pauses and retries with a new signature');

requests=[];
api._cooldownUntil=0;
waits.length=0;
globalThis.fetch=async()=>{
  requests.push(1);
  if(requests.length===1) return new Response(JSON.stringify({status:'FAILED',comment:'Call limit exceeded'}),
    {status:400,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({status:'OK',result:{value:1}}),
    {status:200,headers:{'content-type':'application/json'}});
};
assert.equal((await api.call('problem.info',{problemId:42})).value,1);
assert.equal(requests.length,2);
assert(waits.some(x=>x>=19000 && x<=20000),'fallback backoff should not retry immediately');
console.log('PASS: Polygon JSON rate-limit error also backs off');

requests=[];
api._cooldownUntil=0;
globalThis.fetch=async()=>{
  requests.push(1);
  throw Error('network connection was lost');
};
await assert.rejects(()=>api.call('problem.saveTest',{problemId:42,testset:'tests',testIndex:2,testInput:'1'}),
  /서버에서 처리되었을 수 있으므로 다음 실행에서 상태를 재조회/);
assert.equal(requests.length,1,'Do not repeat uncertain mutations on a network failure');
console.log('PASS: unknown network outcome is not blindly retried');

requests=[];
api._cooldownUntil=0;
globalThis.fetch=async()=>{
  requests.push(1);
  return new Response(JSON.stringify({status:'FAILED',comment:'Invalid input'}),
    {status:400,headers:{'content-type':'application/json'}});
};
await assert.rejects(()=>api.call('problem.saveTest',{problemId:42}),/Invalid input/);
assert.equal(requests.length,1,'Do not retry semantic API failures');
console.log('PASS: Polygon validation failures are not retried');

// A JSON resource is a raw file even when the MIME type is application/json.
api._cooldownUntil=0;
globalThis.fetch=async()=>new Response('{"name":"SOJ provenance","version":1}',{
  status:200, headers:{'content-type':'application/json'}
});
assert.equal(await api.problem('viewFile',42,{type:'resource',name:'source-provenance.json'},{raw:true}),
  '{"name":"SOJ provenance","version":1}');
console.log('PASS: application/json file is returned verbatim, not mistaken for a Polygon API envelope');
const realDateNow=Date.now;
let virtualNow=1800000000000;
Date.now=()=>virtualNow;
PolygonAPI.minimumIntervalMs=3200;
PolygonAPI.sleep=async ms=>{virtualNow+=ms;};
const paced=new PolygonAPI('TESTKEY','TESTSECRET');
const sentAt=[];
globalThis.fetch=async()=>{
  sentAt.push(Date.now());
  return new Response(JSON.stringify({status:'OK',result:1}),{
    status:200,headers:{'content-type':'application/json'}
  });
};
await Promise.all([
  paced.call('problem.info',{problemId:42}),
  paced.call('problem.viewTags',{problemId:42}),
  paced.call('problem.solutions',{problemId:42})
]);
assert.equal(sentAt.length,3);
assert(sentAt[1]-sentAt[0]>=3200 && sentAt[2]-sentAt[1]>=3200,
  'Parallel read requests must be spaced out');
Date.now=realDateNow;
PolygonAPI.sleep=originalSleep;
console.log('PASS: concurrent API requests are paced to avoid bursts');
