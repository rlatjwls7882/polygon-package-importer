import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIndexedDB } from './helpers/storage.mjs';
import { stageJob,readJob,readJobInfo,patchJob,claimJob,releaseJob,clearJob } from '../src/storage/jobs.js';
const job=()=>({id:'job',file:new Blob(['data']),filename:'data.zip',mode:'create',commit:true,verify:true});

test('checkpoint/lock updates never read or re-save the ZIP payload',async()=>{
  const operations=[];globalThis.indexedDB=createFakeIndexedDB(event=>operations.push(event));
  await stageJob(job());operations.length=0;
  await claimJob('job');
  await patchJob('job',{mode:'replace',problemId:'42'});
  for(let i=0;i<50;i++)await patchJob('job',{verification:{packageId:1,stage:'polling'}});
  for(let i=0;i<50;i++){const info=await readJobInfo();assert.equal(info.file,undefined);}
  await releaseJob('job');
  assert(operations.every(event=>event.key==='active'));
  assert(operations.filter(event=>event.method==='put').every(event=>!Object.hasOwn(event.value,'file')));
  const restored=await readJob();assert.equal(await restored.file.text(),'data');assert.equal(restored.problemId,'42');
});

test('legacy inline-Blob jobs migrate on claim without losing resume fields',async()=>{
  globalThis.indexedDB=createFakeIndexedDB();await stageJob(job());
  const store=indexedDB.inspect('jobs','polygon-import-jobs');store.clear();
  store.set('active',{...job(),verification:{stage:'launching',beforeIds:[]}});
  assert.equal((await readJobInfo()).file,undefined);
  assert.equal((await readJob()).file.size,4);
  await claimJob('job');assert.equal(store.get('active').file,undefined);
  assert.equal(store.get('active').storageVersion,2);assert(store.get('activeZip').file);
  assert.equal((await readJob()).verification.stage,'launching');
});

test('stale patches and cleanup cannot alter or remove a newer ZIP',async()=>{
  globalThis.indexedDB=createFakeIndexedDB();await stageJob(job());
  await clearJob('job');await stageJob({...job(),id:'new',file:new Blob(['new'])});
  await assert.rejects(()=>patchJob('job',{problemId:'100'}));
  await clearJob('job');assert.equal(await (await readJob()).file.text(),'new');
  await assert.rejects(()=>patchJob('new',{file:new Blob(['bad'])}));
  await clearJob('new');assert.equal(indexedDB.inspect('jobs','polygon-import-jobs').size,0);
});

test('missing or mismatched payload fails closed and metadata remains inspectable',async()=>{
  globalThis.indexedDB=createFakeIndexedDB();await stageJob(job());
  indexedDB.inspect('jobs','polygon-import-jobs').set('activeZip',{id:'other',file:new Blob(['bad'])});
  assert.equal((await readJobInfo()).id,'job');await assert.rejects(()=>readJob());
});


test('explicit clearing also removes an orphan ZIP with no active metadata',async()=>{
  globalThis.indexedDB=createFakeIndexedDB();await stageJob(job());
  const store=indexedDB.inspect('jobs','polygon-import-jobs');store.delete('active');
  await clearJob();assert.equal(store.size,0);
});
