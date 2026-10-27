// Deterministic work counts; not a browser heap or live Polygon latency measurement.
// node tests/benchmark_lifecycle.mjs /path/to/baseline-checkout
import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeZip } from './helpers/zip.mjs';
import { createFakeIndexedDB, createFakeChromeStorage } from './helpers/storage.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { attachBuild } from './helpers/build.mjs';

if (process.argv[2] !== '--worker') {
  if (!process.argv[2]) throw Error('Pass the baseline checkout directory.');
  const result = {kind:'offline operation counts', node:process.version};
  for (const [name,path] of [['baseline',resolve(process.argv[2])],['updated',fileURLToPath(new URL('../',import.meta.url))]]) {
    const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',path],{encoding:'utf8',maxBuffer:16*1024*1024});
    assert.equal(child.status,0,child.stderr || child.stdout);
    result[name]=JSON.parse(child.stdout);
  }
  console.log(JSON.stringify(result,null,2));
} else {
  const root=pathToFileURL(resolve(process.argv[3])+'/');
  const load=path=>import(new URL(path,root));
  const {ZipArchive}=await load('src/package/zip.js');
  const {verifyProblem}=await load('src/polygon/verify.js');
  const {prepareJudgeTests}=await load('src/polygon/judging.js');
  const {readGroups}=await load('src/package/groups.js');
  const jobs=await load('src/storage/jobs.js');
  const metrics={};

  let active=0,peak=0;const native=globalThis.DecompressionStream;
  globalThis.DecompressionStream=class {
    constructor(format){const stream=new native(format);this.writable=stream.writable;active++;peak=Math.max(peak,active);
      this.readable=stream.readable.pipeThrough(new TransformStream({async transform(chunk,controller){
        await new Promise(resolve=>setImmediate(resolve));controller.enqueue(chunk);},flush(){active--;}}));}
  };
  const files={'problem.xml':'<problem/>'};for(let i=0;i<20;i++)files['data'+i]='text\n'.repeat(20000);
  const archive=new ZipArchive(makeZip(files));
  await Promise.all(Array.from({length:20},(_,i)=>archive.text('data'+i)));
  metrics.parallelZipFiles=20;metrics.peakConcurrentInflations=peak;
  archive.dispose?.();globalThis.DecompressionStream=native;

  const operations=[];globalThis.indexedDB=createFakeIndexedDB(value=>operations.push(value));
  const file=new Blob(['x'.repeat(1024*1024)]);
  await jobs.stageJob({id:'bench',file,mode:'replace',problemId:'42'});await jobs.claimJob('bench');operations.length=0;
  for(let i=0;i<50;i++) {
    const changes={verification:{stage:'polling',revision:1,packageId:100,poll:i}};
    if(jobs.patchJob)await jobs.patchJob('bench',changes);
    else await jobs.stageJob({...await jobs.readJob(),...changes},'bench');
  }
  metrics.checkpointUpdates=50;
  metrics.checkpointPutsWithZip=operations.filter(event=>event.method==='put'&&event.value?.file).length;
  metrics.checkpointBlobBytesSubmitted=operations.reduce((sum,event)=>sum+(event.method==='put'?(event.value?.file?.size||0):0),0);

  const storage=createFakeChromeStorage(),handlers=[];
  globalThis.chrome={...storage.chrome,runtime:{...storage.chrome.runtime,
    getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:handler=>handlers.push(handler)}}};
  await load('src/runtime/background.js');
  await chrome.storage.local.set({[jobs.STATUS_KEY]:{id:'bench',attempt:'a',phase:'running',log:[],progress:0}});
  let writes=0;const save=chrome.storage.local.set;
  chrome.storage.local.set=async value=>{writes++;return save(value);};
  for(let i=0;i<100;i++)await new Promise(resolve=>handlers[0]({type:'IMPORT_PROGRESS',jobId:'bench',attempt:'a',stage:'verifying',message:'Waiting'},
    {url:chrome.runtime.getURL('offscreen.html')},resolve));
  metrics.identicalProgressMessages=100;metrics.statusWrites=writes;

  const mock=createPolygon(),build=attachBuild(mock);
  build.afterBuild=record=>record.detail.invocation.status='RUNNING';
  const waiting=new ZipArchive(makeZip({'problem.xml':'<problem/>','source.cpp':'x'.repeat(100000)}));
  await waiting.text('source.cpp');
  const plan={solutions:[],tests:[],info:{},groups:[]};
  await assert.rejects(()=>verifyProblem({api:mock.api,id:42,archive:waiting,plan,maxPolls:12,pollMs:0,sleep:async()=>{}}));
  metrics.pendingPolls=12;
  metrics.invocationDetailDownloads=mock.calls.filter(call=>call.method==='invocation').length;
  metrics.decodedCacheBytesDuringWait=waiting.cacheBytes;
  waiting.dispose?.();

  let decoded=0;const context={api:{},id:42,plan:{validatorTests:Array.from({length:100},(_,i)=>({index:i+1,verdict:'VALID',inputPath:String(i)})),checkerTests:[]},
    archive:{text:async()=>{decoded++;return 'x'.repeat(1024);}},target:null,apply:()=>{assert.fail('planning wrote data');}};
  await prepareJudgeTests(context);
  metrics.newValidatorSelfTests=100;metrics.inputsDecodedDuringPlanning=decoded;
  metrics.inputCharactersRetainedAfterPlanning=context.judgeTests.reduce((sum,group)=>sum+group.wanted.reduce((n,test)=>n+(test.testInput?.length||0),0),0);

  let groupReads=0;
  const node=(name,attrs={},children=[])=>({localName:name,children,getAttribute:key=>attrs[key]??null,hasAttribute:key=>Object.hasOwn(attrs,key)});
  const ts=node('testset',{},[node('groups',{},Array.from({length:500},(_,i)=>node('group',{name:'g'+i}))) ]);
  const scoring={tests:Array.from({length:500},(_,i)=>({get group(){groupReads++;return 'g'+i;},points:null}))};
  readGroups(ts,scoring);
  metrics.groups=500;metrics.tests=500;metrics.groupMembershipReads=groupReads;
  console.log(JSON.stringify(metrics));
}
