// Exercise popup -> service worker -> offscreen -> status without network access.
import assert from 'node:assert/strict';
import { createFakeIndexedDB, createFakeChromeStorage } from './mock-browser-storage.mjs';
import { stageJob, readJob } from '../job-store.js';
import { saveCredentials } from '../credential-store.js';
import { STATUS_KEY } from '../status.js';

globalThis.indexedDB=createFakeIndexedDB();
const mock=createFakeChromeStorage();
const listeners=[];
let offscreenOpen=false;
let created=0;

const extensionUrl='chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/';
function register(handler) {
  listeners.push(handler);
}
async function sendMessage(message) {
  const url=extensionUrl + (
    message.type==='IMPORT_PROGRESS'||message.type==='IMPORT_COMPLETE'
      ? 'offscreen.html' : 'popup.html');
  for(const handler of listeners) {
    const result=await new Promise((resolve,reject)=>{
      let resolved=false;
      const respond=value=>{resolved=true;resolve(value);};
      try {
        const keep=handler(message,{url},respond);
        if(keep!==true && !resolved) resolve(undefined);
      } catch(error) {reject(error);}
    });
    if(result!==undefined) return result;
  }
  return undefined;
}

const chrome={
  ...mock.chrome,
  runtime:{
    id:'abcdefghijklmnopqrstuvwxyzabcdef',
    getURL:path=>extensionUrl+path,
    getContexts:async()=>offscreenOpen?[{contextType:'OFFSCREEN_DOCUMENT'}]:[],
    onMessage:{addListener:register},
    sendMessage,
    getManifest:()=>({permissions:['storage','offscreen']})
  },
  offscreen:{
    async createDocument(options) {
      assert.deepEqual(options.reasons,['DOM_PARSER']);
      assert.equal(options.url,'offscreen.html');
      offscreenOpen=true;
      created++;
      if(created!==1) return;
      register((message,sender,respond)=>{
        if(message.type!=='IMPORT_EXECUTE') return;
        if(message.jobId==='job-legacy') {
          respond({ok:true});
          return;
        }
        assert.equal(message.jobId,'job-42');
        assert.equal(message.encryptedRecord.version,2);
        respond({ok:true});
        // The simulated popup may close before the offscreen task completes.
        queueMicrotask(async()=>{
          await sendMessage({type:'IMPORT_PROGRESS',jobId:'job-42',
            message:'테스트 29/50',progress:60});
          await sendMessage({type:'IMPORT_COMPLETE',jobId:'job-42',
            phase:'done',progress:100,message:'완료 · 변경 22개',problemId:42});
        });
      });
    },
    async closeDocument(){offscreenOpen=false;}
  }
};
globalThis.chrome=chrome;
await import('../background.js');

const file=new Blob(['zip'],{type:'application/zip'});
const job={id:'job-42',file,filename:'problem.zip',mode:'replace',problemId:'42',commit:true};
await stageJob(job);
const noAuth=await sendMessage({type:'IMPORT_START',jobId:job.id});
assert.equal(noAuth.ok,false);
assert.match(noAuth.error,/API 키/);
assert((await readJob())?.file,'failed preparation must retain the staged ZIP');

await saveCredentials({key:'TESTKEY',secret:'TESTSECRET'});
const start=await sendMessage({type:'IMPORT_START',jobId:job.id});
assert.equal(start.ok,true);
assert.equal(created,1);
await new Promise(resolve=>setTimeout(resolve,30));
const current=await sendMessage({type:'IMPORT_QUERY'});
assert.equal(current.ok,true);
assert.equal(current.status.phase,'done');
assert.equal(current.status.progress,100);
assert.equal(current.status.problemId,42);
assert(current.status.log.some(s=>s.includes('테스트 29/50')));
assert.equal((await mock.chrome.storage.local.get(STATUS_KEY))[STATUS_KEY].phase,'done');
console.log('PASS: popup starts an offscreen job and progress survives after popup closes');

await new Promise(resolve=>setTimeout(resolve,900));
assert.equal(offscreenOpen,false);
const clear=await sendMessage({type:'IMPORT_CLEAR'});
assert.equal(clear.ok,true);
assert.equal(await readJob(),undefined);
assert.equal((await mock.chrome.storage.local.get(STATUS_KEY))[STATUS_KEY],undefined);
console.log('PASS: offscreen context closes after completion; job can be discarded');

const interrupted={...job,id:'job-interrupted'};
await stageJob(interrupted);
await mock.chrome.storage.local.set({[STATUS_KEY]:{
  id:interrupted.id, phase:'running',filename:interrupted.filename,
  message:'수동 테스트 23/50', progress:45
}});
const recovered=await sendMessage({type:'IMPORT_QUERY'});
assert.equal(recovered.status.phase,'error');
assert(recovered.status.message.includes('중단'));
assert.equal((await readJob()).id,interrupted.id);
console.log('PASS: browser restart marks abandoned work as retryable');

// Existing failed create jobs must resume the known problem, not create a
// second one, even if they were staged by the old extension version.
const legacy={...job,id:'job-legacy',mode:'create',problemId:null};
await stageJob(legacy);
await mock.chrome.storage.local.set({[STATUS_KEY]:{
  id:legacy.id, phase:'error', partial:true,
  problemId:583386, filename:legacy.filename, message:'file missing'
}});
const retry=await sendMessage({type:'IMPORT_START',jobId:legacy.id});
assert.equal(retry.ok,true);
const restored=await readJob();
assert.equal(restored.mode,'replace');
assert.equal(restored.problemId,'583386');
assert.equal(restored.file.size,file.size);
const resumed=await sendMessage({type:'IMPORT_QUERY'});
assert.equal(resumed.status.mode,'replace');
assert.equal(resumed.status.problemId,'583386');
console.log('PASS: retry of a previously failed create reuses its problem ID');
