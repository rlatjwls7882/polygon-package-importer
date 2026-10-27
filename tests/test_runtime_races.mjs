import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIndexedDB, createFakeChromeStorage } from './helpers/storage.mjs';
import { stageJob, readJob, clearJob, claimJob, STATUS_KEY } from '../src/storage/jobs.js';
import { saveCredentials } from '../src/storage/credentials.js';
let instance=0;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function environment({failStart = false} = {}) {
  globalThis.indexedDB=createFakeIndexedDB();
  const storage=createFakeChromeStorage(),handlers=[],timers=new Map();
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
  const root='chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/';
  let opened=false,closed=0,attempt;
  globalThis.setTimeout=fn=>{const id=timers.size+1;timers.set(id,fn);return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  const chrome={...storage.chrome,
    runtime:{getURL:path=>root+path,getContexts:async()=>opened?[{}]:[],
      onMessage:{addListener:handler=>handlers.push(handler)},
      async sendMessage(message) {
        if(message.type==='IMPORT_EXECUTE'){attempt=message.attempt;return failStart?{ok:false,reason:'start failed'}:{ok:true};}
        if(message.type==='IMPORT_PROGRESS'||message.type==='IMPORT_COMPLETE')message={attempt,...message};
        const url=root+(message.type==='IMPORT_PROGRESS'||message.type==='IMPORT_COMPLETE'?'offscreen.html':'popup.html');
        for(const handler of handlers) {
          const result=await new Promise((resolve,reject)=>{
            try {const keep=handler(message,{url},resolve);if(keep!==true)resolve(undefined);}catch(error){reject(error);}
          });
          if(result!==undefined)return result;
        }
      }
    },
    offscreen:{createDocument:async()=>{opened=true;},closeDocument:async()=>{opened=false;closed++;}}
  };
  globalThis.chrome=chrome;
  await saveCredentials({key:'TESTKEY',secret:'TESTSECRET'});
  await import('../src/runtime/background.js?race='+instance++);
  return {storage,timers,send:message=>chrome.runtime.sendMessage(message),get opened(){return opened;},get closed(){return closed;},
    restore(){globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;},
    async start(id){await stageJob({id,file:new Blob(['zip']),filename:id+'.zip',mode:'replace',problemId:'42'});
      assert.equal((await chrome.runtime.sendMessage({type:'IMPORT_START',jobId:id})).ok,true);}
  };
}

test('previous completion timer cannot close a new upload',async()=>{
  const e=await environment();
  try {
    await e.start('first');
    await e.send({type:'IMPORT_COMPLETE',jobId:'first',phase:'done',message:'done'});
    await e.start('second');
    for(const callback of [...e.timers.values()])await callback();
    await tick();
    assert.equal(e.opened,true,'Old close timer killed the second upload');
    assert.equal((await e.send({type:'IMPORT_QUERY'})).status.phase,'running');
  } finally {e.restore();}
});

test('delayed progress cannot overwrite terminal completion',async()=>{
  const e=await environment();
  try {
    await e.start('progress');
    let entered,release;
    const atWrite=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
    const original=e.storage.chrome.storage.local.set;
    e.storage.chrome.storage.local.set=async values=>{
      if(values[STATUS_KEY]?.message==='slow'){entered();await gate;}
      return original(values);
    };
    const progress=e.send({type:'IMPORT_PROGRESS',jobId:'progress',message:'slow'});
    await atWrite;
    const complete=e.send({type:'IMPORT_COMPLETE',jobId:'progress',phase:'done',message:'done'});
    await tick();release();
    await Promise.all([progress,complete]);
    assert.equal(e.storage.data.get(STATUS_KEY).phase,'done');
    assert.equal(e.storage.data.get(STATUS_KEY).message,'done');
  } finally {e.restore();}
});

test('starting a known interrupted job works without querying status first',async()=>{
  const e=await environment();
  try {
    await stageJob({id:'recover',file:new Blob(['zip']),filename:'r.zip',mode:'replace',problemId:'42'});
    await e.storage.chrome.storage.local.set({[STATUS_KEY]:{id:'recover',phase:'running'}});
    assert.equal((await e.send({type:'IMPORT_START',jobId:'recover'})).ok,true);
  } finally {e.restore();}
});

test('a second popup cannot replace the ZIP of a running upload',async()=>{
  const e=await environment();
  try {
    await e.start('protected');
    await assert.rejects(()=>stageJob({id:'other',file:new Blob(['other']),mode:'create'}));
    assert.equal((await readJob()).id,'protected');
  } finally {e.restore();}
});

test('completion cleanup compares and deletes in one transaction',async()=>{
  globalThis.indexedDB=createFakeIndexedDB();
  await stageJob({id:'old',file:new Blob(['old'])});
  await Promise.all([clearJob('old'),stageJob({id:'new',file:new Blob(['new'])})]);
  assert.equal((await readJob())?.id,'new');
});

test('an interrupted claim before status persistence does not strand the ZIP lock',async()=>{
  const e=await environment();
  try {
    await stageJob({id:'claimed',file:new Blob(['zip']),mode:'replace',problemId:'42'});
    await claimJob('claimed');
    assert.equal((await e.send({type:'IMPORT_START',jobId:'claimed'})).ok,true);
  } finally {e.restore();}
});

test('late messages from an old attempt cannot complete the retry of the same job',async()=>{
  const e=await environment();
  try {
    await e.start('retry');
    const oldAttempt=e.storage.data.get(STATUS_KEY).attempt;
    await e.send({type:'IMPORT_COMPLETE',jobId:'retry',phase:'error',message:'failed'});
    assert.equal((await e.send({type:'IMPORT_START',jobId:'retry'})).ok,true);
    const current=e.storage.data.get(STATUS_KEY).attempt;
    assert.notEqual(current,oldAttempt);
    const result=await e.send({type:'IMPORT_COMPLETE',jobId:'retry',attempt:oldAttempt,phase:'done',message:'old'});
    assert.equal(result.ok,false);
    assert.equal(e.storage.data.get(STATUS_KEY).phase,'running');
  } finally {e.restore();}
});


test('unchanged progress does not repeatedly write storage or duplicate log entries',async()=>{
  const e=await environment();
  try {
    await e.start('status');let writes=0;
    const original=e.storage.chrome.storage.local.set;
    e.storage.chrome.storage.local.set=async values=>{if(values[STATUS_KEY])writes++;return original(values);};
    for(let i=0;i<20;i++)await e.send({type:'IMPORT_PROGRESS',jobId:'status',stage:'verifying',message:'Waiting',committed:true});
    assert.equal(writes,1);
    assert.equal(e.storage.data.get(STATUS_KEY).log.filter(message=>message==='Waiting').length,1);
    await e.send({type:'IMPORT_COMPLETE',jobId:'status',phase:'done',stage:'verified',message:'Waiting'});
    assert.equal(writes,2,'Terminal state must always be persisted');
    assert.equal(e.storage.data.get(STATUS_KEY).phase,'done');
  } finally {e.restore();}
});


test('failed start closes the offscreen page while retaining the retryable ZIP',async()=>{
  const e=await environment({failStart:true});
  try {
    await stageJob({id:'start-failed',file:new Blob(['zip']),mode:'replace',problemId:'42'});
    const result=await e.send({type:'IMPORT_START',jobId:'start-failed'});
    assert.equal(result.ok,false);assert.equal(e.opened,false);
    const job=await readJob();assert(job.file);assert.equal(job.locked,false);
  } finally {e.restore();}
});
