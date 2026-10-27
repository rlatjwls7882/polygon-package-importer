import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { createFakeIndexedDB, createFakeChromeStorage } from './helpers/storage.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { attachBuild } from './helpers/build.mjs';
import { fixture } from './helpers/format-fixture.mjs';
import { installNativeTestParser } from './helpers/native-xml.mjs';
import { saveCredentials } from '../src/storage/credentials.js';
import { stageJob, readJob, claimJob, releaseJob } from '../src/storage/jobs.js';
import { PolygonAPI } from '../src/polygon/api.js';

// Exercise the real offscreen -> encrypted credentials -> importer -> durable
// job checkpoint chain, while replacing only remote Polygon API transport.
globalThis.indexedDB=createFakeIndexedDB();
const storage=createFakeChromeStorage(),listeners=[],messages=[];
let completed;
globalThis.chrome={...storage.chrome,runtime:{...storage.chrome.runtime,
  onMessage:{addListener:handler=>listeners.push(handler)},
  sendMessage:async message=>{
    messages.push(structuredClone(message));
    if(message.type==='IMPORT_COMPLETE')completed(message);
    return {ok:true};
  }
}};
const credentials=await saveCredentials({key:'KEY',secret:'SECRET'});
const f=fixture({interactive:true,twice:true,percent:true,extraTags:true,padded:true});
const mock=createPolygon(),build=attachBuild(mock);
const original=PolygonAPI.prototype.call;
PolygonAPI.prototype.call=function(method,args={},options={}) {
  if(method.startsWith('problem.')) {
    const {problemId,...params}=args;
    if(method==='problem.create')return mock.api.call(method,args);
    return mock.api.problem(method.slice('problem.'.length),Number(problemId),params,options);
  }
  return mock.api.call(method,args);
};
installNativeTestParser();
await import('../src/runtime/offscreen.js');
async function start(attempt) {
  await claimJob('verified-job');
  const done=new Promise(resolve=>completed=resolve);
  let reply;
  listeners[0]({type:'IMPORT_EXECUTE',jobId:'verified-job',attempt,encryptedRecord:credentials.record,locale:'en'},
    {},value=>reply=value);
  assert.equal(reply.ok,true);
  const result=await done;
  await new Promise(resolve=>setImmediate(resolve));
  return result;
}
try {
  await stageJob({id:'verified-job',file:f.file,filename:'fixture.zip',mode:'create',commit:true,verify:true});
  build.loseBuildResponse=true;
  const first=await start('first');
  assert.equal(first.phase,'error');assert.equal(first.committed,true);
  assert.equal(first.stage,'verification-failed');
  const retained=await readJob();
  assert.equal(retained.mode,'replace');assert.equal(retained.problemId,'42');
  assert.equal(retained.verification.stage,'launching');
  assert.equal(retained.verify,true);assert(retained.file);
  assert.equal(mock.state.creates,1);assert.equal(build.builds,1);
  await releaseJob('verified-job');
  const second=await start('retry');
  assert.equal(second.phase,'done');assert.equal(second.stage,'verified');
  assert.equal(second.verification.state,'verified');assert.equal(second.verification.runs,4);
  assert.equal(mock.state.creates,1);assert.equal(mock.state.commits,1);assert.equal(build.builds,1);
  assert.equal(await readJob(),undefined);
  assert(messages.some(message=>message.type==='IMPORT_PROGRESS' && message.stage==='verifying' && message.committed));
  assert(messages.every(message=>!JSON.stringify(message).includes('SECRET')));
  console.log('PASS: offscreen failure persists verification checkpoint; retry resumes one build and preserves committed status');
} finally {PolygonAPI.prototype.call=original;}
