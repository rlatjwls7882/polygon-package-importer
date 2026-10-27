// Synthetic operation/reference counts; not browser heap or live Polygon timings.
// node tests/benchmark_request_resources.mjs /path/to/v0.9.1-checkout
import './helpers/i18n.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createFakeIndexedDB,createFakeChromeStorage } from './helpers/storage.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
if(!process.argv[2])throw Error('Pass a baseline checkout directory.');
const results={kind:'offline operation counts',node:process.version};
for(const [label,root] of [['baseline',pathToFileURL(resolve(process.argv[2])+'/')],['updated',new URL('../',import.meta.url)]]) {
 const {PolygonAPI}=await import(new URL('src/polygon/api.js',root));
 const {CredentialsUI}=await import(new URL('src/ui/credentials.js',root));
 const {saveCredentials,CREDENTIAL_KEY}=await import(new URL('src/storage/credentials.js',root));
 const {checkInvocation}=await import(new URL('src/polygon/verification/invocation.js',root));
 const fetch=globalThis.fetch,sleep=PolygonAPI.sleep,interval=PolygonAPI.minimumIntervalMs;
 let release,entered,settled=0;const waiting=new Promise(resolve=>entered=resolve);
 PolygonAPI.minimumIntervalMs=0;PolygonAPI.sleep=()=>{entered();return new Promise(resolve=>release=resolve);};
 globalThis.fetch=async()=>{assert.fail('A disposed queued request reached the network');};
 const api=new PolygonAPI('KEY','SECRET');api._cooldownUntil=Date.now()+60000;
 const jobs=Array.from({length:40},()=>api.call('problem.info').catch(()=>{settled++;}));
 await waiting;api.dispose();await tick();await tick();const pendingAfterDispose=40-settled;
 release();await Promise.all(jobs);PolygonAPI.sleep=sleep;
 let bytes=0,cancelled=0;const body=new Uint8Array(1024*1024).fill(120);
 globalThis.fetch=async()=>new Response(new ReadableStream({pull(c){if(bytes===body.length){c.close();return;}const end=Math.min(body.length,bytes+4096);c.enqueue(body.slice(bytes,end));bytes=end;},cancel(){cancelled++;}}));
 const bounded=new PolygonAPI('KEY','SECRET',{rawBytes:16384});
 await bounded.call('problem.viewFile',{}, {raw:true}).catch(()=>{});bounded.dispose();
 globalThis.fetch=fetch;PolygonAPI.sleep=sleep;PolygonAPI.minimumIntervalMs=interval;

 const solutions=100,tests=1000;
 const plan={solutions:Array.from({length:solutions},(_,i)=>({name:'solution'+i+'.cpp',tag:i?'OK':'MA'})),tests:Array.from({length:tests},(_,i)=>({index:i+1}))};
 const detail={invocation:{id:2,packageId:1,testset:'tests',status:'FINISHED',violateTag:false,solutions:plan.solutions.map(s=>s.name),tests:plan.tests.map(t=>t.index)},
 solutionTags:plan.solutions.map(s=>({...s,testsetTags:{},groupTags:{}})),runs:plan.solutions.flatMap(s=>plan.tests.map(t=>({solution:s.name,test:t.index,verdict:'OK',violateTag:false})))};
 const stringify=JSON.stringify;let keys=0,keyCharacters=0;
 JSON.stringify=(value,...args)=>{const result=stringify(value,...args);if(Array.isArray(value)&&typeof value[0]==='string'&&typeof value[1]==='number'){keys++;keyCharacters+=result.length;}return result;};
 try {assert.equal(checkInvocation(detail,{id:1},plan).runs,solutions*tests);} finally {JSON.stringify=stringify;}

 globalThis.indexedDB=createFakeIndexedDB();const storage=createFakeChromeStorage();globalThis.chrome=storage.chrome;
 const listeners=new Set();chrome.storage.onChanged={addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)};
 globalThis.window={confirm:()=>true};const nodes=new Map();globalThis.document={getElementById(id){if(!nodes.has(id))nodes.set(id,{value:'',addEventListener(){},removeEventListener(){}});return nodes.get(id);}};
 await saveCredentials({key:'KEY',secret:'SECRET'});const ui=new CredentialsUI();await ui.init();
 let unblock,atRead,reads=0;const gate=new Promise(resolve=>unblock=resolve),started=new Promise(resolve=>atRead=resolve),get=chrome.storage.local.get;
 chrome.storage.local.get=async args=>{reads++;const value=await get(args);if(reads===1){atRead();await gate;}return value;};
 const initial=ui.reload();await started;
 for(let i=0;i<25;i++)for(const listener of listeners)listener({[CREDENTIAL_KEY]:{newValue:{version:2,iv:'different',ciphertext:'different'}}},'local');
 storage.data.delete(CREDENTIAL_KEY);unblock();await initial;for(let i=0;i<10;i++)await tick();
 chrome.storage.local.get=get;ui.dispose?.();listeners.clear();
 results[label]={queuedRequests:40,queuedRequestsStillWaitingAfterDispose:pendingAfterDispose,
   rawResponseBytes:body.length,configuredRawLimit:16384,responseBytesRead:bytes,responseCancelled:cancelled,
   checkedRuns:solutions*tests,perRunStringKeys:keys,perRunStringCharacters:keyCharacters,
   credentialChangeEvents:25,credentialStorageReads:reads};
}
console.log(JSON.stringify(results,null,2));
