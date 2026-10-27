import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CredentialsUI } from '../src/ui/credentials.js';
import { createFakeIndexedDB,createFakeChromeStorage } from './helpers/storage.mjs';
import { saveCredentials,CREDENTIAL_KEY } from '../src/storage/credentials.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function dom(){const nodes=new Map();globalThis.document={getElementById(id){if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,handlers:new Map(),addEventListener(type,fn){this.handlers.set(type,fn);},removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}});return nodes.get(id);}};globalThis.window={confirm:()=>true};return nodes;}
async function environment(){
  globalThis.indexedDB=createFakeIndexedDB();const storage=createFakeChromeStorage();globalThis.chrome=storage.chrome;const nodes=dom();
  const listeners=new Set();chrome.storage.onChanged={addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)};
  await saveCredentials({key:'KEY',secret:'SECRET'});
  return {storage,nodes,listeners,notify(){for(const fn of listeners)fn({[CREDENTIAL_KEY]:{newValue:{version:2,iv:'updated',ciphertext:'updated'}}},'local');}};
}
test('credential views unregister storage/DOM listeners and ignore a late decrypt after disposal',async()=>{
  const e=await environment(),ui=new CredentialsUI();await ui.init();assert.equal(e.listeners.size,1);
  let release,entered;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r),get=chrome.storage.local.get;
  chrome.storage.local.get=async keys=>{const value=await get(keys);entered();await gate;return value;};
  let renders=0;ui.onChange=()=>renders++;
  const reloading=ui.reload();await waiting;
  try {assert.equal(typeof ui.dispose,'function');ui.dispose();assert.equal(e.listeners.size,0);assert([...e.nodes.values()].every(node=>node.handlers.size===0));}
  finally {release();await reloading;chrome.storage.local.get=get;}
  assert.equal(renders,0,'A disposed view rendered after an async reload');
});

test('credential change bursts are coalesced while still applying the latest state',async()=>{
  const e=await environment(),ui=new CredentialsUI();await ui.init();
  let release,entered,reads=0;const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r),get=chrome.storage.local.get;
  chrome.storage.local.get=async keys=>{reads++;const value=await get(keys);if(reads===1){entered();await gate;}return value;};
  const first=ui.reload();await waiting;
  try {
    for(let i=0;i<25;i++)e.notify();
    e.storage.data.delete(CREDENTIAL_KEY);release();await first;
    for(let i=0;i<6;i++)await tick();
    assert(reads<=2,'Every storage event started a separate decrypt/read: '+reads);
    assert.equal(ui.state,'empty','Latest deletion was overwritten by an older reload');
  } finally {release();chrome.storage.local.get=get;ui.dispose?.();}
});

test('an older reload cannot overwrite a newly saved credential record',async()=>{
 const e=await environment(),ui=new CredentialsUI();await ui.init();
 const get=chrome.storage.local.get;let release,entered,reads=0;
 const gate=new Promise(r=>release=r),waiting=new Promise(r=>entered=r);
 chrome.storage.local.get=async keys=>{const value=await get(keys);if(++reads===1){entered();await gate;}return value;};
 const oldReload=ui.reload();await waiting;
 try {
   document.getElementById('key').value='NEWKEY';document.getElementById('secret').value='NEWSECRET';
   await ui.save();const fresh=e.storage.data.get(CREDENTIAL_KEY);
   release();await oldReload;
   assert.equal(ui.record.iv,fresh.iv,'A stale decrypt replaced the newly saved record');
 } finally {release();await oldReload;chrome.storage.local.get=get;ui.dispose();}
});
