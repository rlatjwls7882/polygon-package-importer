import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { ZipArchive } from '../src/package/zip.js';
import { PolygonAPI } from '../src/polygon/api.js';
import { makeZip } from './helpers/zip.mjs';
import { fixture } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { attachBuild } from './helpers/build.mjs';
import { installNativeTestParser } from './helpers/native-xml.mjs';
import { createPackageAnalysis } from '../src/ui/package-analysis.js';
import { prepareJudgeTests } from '../src/polygon/judging.js';
import { readBinary } from '../src/polygon/response.js';
import { executeImport } from '../src/polygon/import.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('parallel ZIP reads bound active inflations, not only retained cache bytes',async()=>{
  const native=globalThis.DecompressionStream;let active=0,peak=0;
  globalThis.DecompressionStream=class {
    constructor(format){const stream=new native(format);this.writable=stream.writable;
      active++;peak=Math.max(peak,active);
      this.readable=stream.readable.pipeThrough(new TransformStream({
        async transform(chunk,controller){await tick();controller.enqueue(chunk);},flush(){active--;}
      }));}
  };
  try {
    const files={'problem.xml':'<problem/>'};
    for(let i=0;i<20;i++)files['data'+i]='text\n'.repeat(20000);
    const archive=new ZipArchive(makeZip(files));
    await Promise.all(Array.from({length:20},(_,i)=>archive.text('data'+i)));
    assert(peak<=2,'Too many simultaneous decompressions: '+peak);
    archive.dispose?.();
  } finally {globalThis.DecompressionStream=native;}
});

test('archive disposal releases buffers and prevents late reads from refilling the cache',async()=>{
  const archive=new ZipArchive(makeZip({'problem.xml':'<problem/>','large':'abc\n'.repeat(100000)}));
  await archive.text('problem.xml');
  const reading=archive.text('large');
  const result=reading.then(()=>null,error=>error);
  assert.equal(typeof archive.dispose,'function');
  archive.dispose();
  assert.equal((await result)?.name,'AbortError');
  assert.equal(archive.buffer,null);assert.equal(archive.cacheBytes,0);
  assert.equal(archive.entries.size,0);assert.equal(archive.pending.size,0);
  await assert.rejects(()=>archive.text('large'),{name:'AbortError'});
  archive.dispose();
});

test('HTTP 429 response bodies are cancelled before backing off',async()=>{
  const fetch=globalThis.fetch,sleep=PolygonAPI.sleep,interval=PolygonAPI.minimumIntervalMs;
  let cancelled=0,calls=0;
  PolygonAPI.sleep=async()=>{};PolygonAPI.minimumIntervalMs=0;
  globalThis.fetch=async()=>++calls===1?
    new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));},cancel(){cancelled++;}}),{status:429}):
    new Response(JSON.stringify({status:'OK',result:42}));
  try {
    assert.equal(await new PolygonAPI('KEY','SECRET').call('problem.info'),42);
    assert.equal(cancelled,1);
  } finally {globalThis.fetch=fetch;PolygonAPI.sleep=sleep;PolygonAPI.minimumIntervalMs=interval;}
});

test('pending invocations are polled using summaries without downloading every run',async()=>{
  const f=fixture(),mock=createPolygon(),build=attachBuild(mock);
  build.afterBuild=record=>{record.detail.invocation.status='RUNNING';};
  installNativeTestParser();
  await assert.rejects(()=>executeImport({api:mock.api,job:{file:f.file,mode:'create',commit:true,verify:true},
    verificationOptions:{maxPolls:4,pollMs:0,sleep:async()=>{}}}));
  assert.equal(mock.calls.filter(call=>call.method==='invocations').length,4);
  assert.equal(mock.calls.filter(call=>call.method==='invocation').length,0);
});

test('success and verification errors always release both original and built ZIPs',async()=>{
  const original=ZipArchive.fromFile,opened=[];
  ZipArchive.fromFile=async function(...args){const archive=await original.apply(this,args);opened.push(archive);return archive;};
  try {
    for(const corrupt of [false,true]) {
      const f=fixture(),mock=createPolygon(),build=attachBuild(mock);installNativeTestParser();
      if(corrupt)build.transformArchive=(_,contents)=>{contents['solutions/main.cpp']='broken';};
      const operation=executeImport({api:mock.api,job:{file:f.file,mode:'create',commit:true,verify:true},
        verificationOptions:{maxPolls:1,pollMs:0,sleep:async()=>{}}});
      if(corrupt)await assert.rejects(()=>operation);else await operation;
    }
    assert.equal(opened.length,4);
    assert(opened.every(archive=>archive.buffer===null && archive.cacheBytes===0));
  } finally {ZipArchive.fromFile=original;}
});


test('superseding popup analysis aborts the old archive and unregisters its signal listener',async()=>{
  const native=ZipArchive.fromFile,opened=[];let release,entered;
  const gate=new Promise(resolve=>release=resolve),atRead=new Promise(resolve=>entered=resolve);
  ZipArchive.fromFile=async function(...args){
    const archive=await native.apply(this,args);opened.push(archive);
    if(opened.length===1){const text=archive.text.bind(archive);archive.text=async path=>{entered();await gate;return text(path);};}
    return archive;
  };
  try {
    installNativeTestParser();const analysis=createPackageAnalysis(),f=fixture();
    const first=analysis.analyze(f.file).then(()=>null,error=>error);
    await atRead;
    const second=analysis.analyze(f.file);
    release();assert.equal((await first)?.name,'AbortError');
    assert.equal((await second).name,'audit-fixture');
    assert(opened.every(archive=>archive.buffer===null && archive.pending.size===0));
    assert(opened.every(archive=>getEventListeners(archive.signal,'abort').length===0));
    analysis.cancel();
  } finally {ZipArchive.fromFile=native;}
});

test('invalid package analysis releases memory even before import orchestration begins',async()=>{
  const native=ZipArchive.fromFile,opened=[];
  ZipArchive.fromFile=async function(...args){const archive=await native.apply(this,args);opened.push(archive);return archive;};
  try {
    installNativeTestParser();const f=fixture({noMain:true});
    await assert.rejects(()=>executeImport({job:{file:f.file,mode:'create'},api:{call(){assert.fail('Invalid package wrote remotely');}}}));
    assert.equal(opened.length,1);assert.equal(opened[0].buffer,null);
  } finally {ZipArchive.fromFile=native;}
});

test('self-test planning retains paths instead of decoding every new input in advance',async()=>{
  let reads=0;
  const context={api:{},id:42,plan:{validatorTests:Array.from({length:100},(_,i)=>({index:i+1,verdict:'VALID',inputPath:String(i)})),checkerTests:[]},
    archive:{text:async()=>{reads++;return 'input';}},target:null,apply:()=>{assert.fail('Planning should not upload');}};
  await prepareJudgeTests(context);
  assert.equal(reads,0);
  assert(context.judgeTests[0].wanted.every(test=>!Object.hasOwn(test,'testInput')));
});

test('bounded binary download cancels declared and streamed oversize bodies',async()=>{
  for(const declared of [false,true]) {
    let cancelled=0,delivered=0;
    const response=new Response(new ReadableStream({
      pull(controller){delivered++;controller.enqueue(new Uint8Array(4));},cancel(){cancelled++;}
    }),{headers:declared?{'content-length':'1000'}:{}});
    await assert.rejects(()=>readBinary(response,8,'too big'),/too big/);
    assert.equal(cancelled,1);assert(delivered<=4,'Unbounded stream drained past its limit');
  }
  const blob=await readBinary(new Response('abc'),8,'too big');assert.equal(await blob.text(),'abc');
});

test('API response parsing clears its timers and session disposal rejects queued work',async()=>{
  const nativeFetch=globalThis.fetch,nativeSet=globalThis.setTimeout,nativeClear=globalThis.clearTimeout,interval=PolygonAPI.minimumIntervalMs;
  const timers=new Set();PolygonAPI.minimumIntervalMs=0;
  globalThis.setTimeout=(fn,ms,...args)=>{const id=nativeSet(fn,ms,...args);timers.add(id);return id;};
  globalThis.clearTimeout=id=>{timers.delete(id);nativeClear(id);};
  try {
    const api=new PolygonAPI('KEY','SECRET');
    for(const [body,options] of [[JSON.stringify({status:'OK',result:42}),{}],['plain',{raw:true}],['zip',{binary:true}]]) {
      globalThis.fetch=async()=>new Response(body);
      await api.call('problem.info',{},options);
      assert.equal(timers.size,0);assert.equal(api.session.requests.size,0);assert.equal(api.session.responses.size,0);
    }
    let started,fetches=0;const entered=new Promise(resolve=>started=resolve);
    globalThis.fetch=async(url,{signal})=>{fetches++;started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));};
    const first=api.call('problem.saveTest').then(()=>null,error=>error);
    const second=api.call('problem.files').then(()=>null,error=>error);
    await entered;api.dispose();
    assert(await first instanceof Error);assert.equal((await second)?.name,'AbortError');
    assert.equal(fetches,1);assert.equal(timers.size,0);assert.equal(api.key,'');assert.equal(api.secret,'');
  } finally {
    for(const timer of timers)nativeClear(timer);
    globalThis.fetch=nativeFetch;globalThis.setTimeout=nativeSet;globalThis.clearTimeout=nativeClear;PolygonAPI.minimumIntervalMs=interval;
  }
});


test('the API queue tail does not retain the last raw response body',async()=>{
  const fetch=globalThis.fetch,interval=PolygonAPI.minimumIntervalMs;PolygonAPI.minimumIntervalMs=0;
  globalThis.fetch=async()=>new Response('large raw source');
  try {
    const api=new PolygonAPI('KEY','SECRET');
    assert.equal(await api.problem('viewFile',42,{}, {raw:true}),'large raw source');
    assert.equal(await api.session.tail,undefined,'Queue tail retained a successful response value');
    api.dispose();
  } finally {globalThis.fetch=fetch;PolygonAPI.minimumIntervalMs=interval;}
});
