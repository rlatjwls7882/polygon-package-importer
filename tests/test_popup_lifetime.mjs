import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPopup } from '../src/ui/popup-controller.js';
import { createFakeIndexedDB,createFakeChromeStorage } from './helpers/storage.mjs';
import { saveCredentials } from '../src/storage/credentials.js';
import { STATUS_KEY } from '../src/storage/jobs.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element extends EventTarget {
  constructor(){super();this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.files=[];this.textContent='';this.dataset={};this.listeners=new Set();}
  addEventListener(type,fn,opts){this.listeners.add(fn);super.addEventListener(type,fn,opts);}
  removeEventListener(type,fn,opts){this.listeners.delete(fn);super.removeEventListener(type,fn,opts);}
}
async function environment(){
 globalThis.indexedDB=createFakeIndexedDB();const storage=createFakeChromeStorage();globalThis.chrome=storage.chrome;
 const listeners=new Set();chrome.storage.onChanged={addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)};
 await saveCredentials({key:'KEY',secret:'SECRET'});
 const nodes=new Map(),radio=new Element();radio.checked=true;radio.value='create';
 globalThis.document={documentElement:{lang:'en'},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},querySelector:()=>radio,querySelectorAll:sel=>sel.startsWith('input')?[radio]:[]};
 document.getElementById('commit').checked=true;document.getElementById('verify').checked=true;
 globalThis.window=new Element();window.confirm=()=>true;
 chrome.runtime.sendMessage=async()=>({ok:true,status:null});
 return {storage,listeners,nodes,radio,notify(status){for(const fn of listeners)fn({[STATUS_KEY]:{newValue:status}},'local');}};
}
test('repeated popup mount/unmount leaves no subscriptions or DOM handlers',async()=>{
 const e=await environment();
 for(let i=0;i<15;i++) {
   const popup=createPopup();await popup.init();assert.equal(e.listeners.size,2);
   await popup.init();assert.equal(e.listeners.size,2,'Initialization must be idempotent');
   popup.dispose();popup.dispose();
   assert.equal(e.listeners.size,0);assert([...e.nodes.values(),e.radio,window].every(node=>node.listeners.size===0));
 }
});
test('a delayed initial query cannot overwrite a newer completion storage event',async()=>{
 const e=await environment();let release,entered;
 const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
 chrome.runtime.sendMessage=async()=>{entered();await gate;return {ok:true,status:{id:'a',phase:'running',message:'old-running'}};};
 const popup=createPopup(),initializing=popup.init();await waiting;
 e.notify({id:'a',phase:'done',message:'completed-new',log:[]});release();await initializing;
 assert(document.getElementById('stateLabel').textContent.includes('completed-new'));
 assert.equal(document.getElementById('clearStatus').hidden,false);popup.dispose();
});
test('pagehide during initialization removes listeners and suppresses late UI work',async()=>{
 const e=await environment();let release,entered;
 const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
 chrome.runtime.sendMessage=async()=>{entered();await gate;return {ok:true,status:{id:'a',phase:'done',message:'must-not-render'}};};
 const popup=createPopup(),initializing=popup.init();await waiting;
 window.dispatchEvent(new Event('pagehide'));assert.equal(e.listeners.size,0);
 release();await initializing;await tick();
 assert(!document.getElementById('stateLabel').textContent.includes('must-not-render'));
});
