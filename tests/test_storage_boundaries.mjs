import { openDatabase, withStore } from '../src/storage/database.js';
import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJobInfo } from '../src/storage/jobs.js';
import { saveCredentials, loadCredentials, CREDENTIAL_KEY, decryptCredentialRecord } from '../src/storage/credentials.js';
import { createFakeIndexedDB, createFakeChromeStorage } from './helpers/storage.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

for(const kind of ['job','credentials'])test('blocked '+kind+' open closes a late successful database connection',async()=>{
  let request,closed=0;
  globalThis.chrome=createFakeChromeStorage().chrome;
  globalThis.indexedDB={open(){request={};return request;}};
  const attempt=kind==='job'?readJobInfo():saveCredentials({key:'KEY',secret:'SECRET'});
  const rejected=assert.rejects(()=>attempt);
  await tick();request.onblocked();await rejected;
  request.result={close(){closed++;},transaction(){assert.fail('Rejected open must not start a transaction');}};
  request.onsuccess();
  assert.equal(closed,1);
});

test('two first-time saves use one persisted encryption key, even with reversed crypto completion',async()=>{
  globalThis.indexedDB=createFakeIndexedDB();const storage=createFakeChromeStorage();globalThis.chrome=storage.chrome;
  const generate=crypto.subtle.generateKey.bind(crypto.subtle),encrypt=crypto.subtle.encrypt.bind(crypto.subtle);
  let generated=0,releaseGenerated,releaseSlow,slowStarted;
  const both=new Promise(resolve=>releaseGenerated=resolve),slow=new Promise(resolve=>releaseSlow=resolve),atSlow=new Promise(resolve=>slowStarted=resolve);
  crypto.subtle.generateKey=async(...args)=>{const key=await generate(...args);if(++generated===2)releaseGenerated();await both;return key;};
  crypto.subtle.encrypt=async(...args)=>{
    if(new TextDecoder().decode(args[2]).includes('FIRSTKEY')){slowStarted();await slow;}
    return encrypt(...args);
  };
  try {
    const first=saveCredentials({key:'FIRSTKEY',secret:'FIRSTSECRET'}).then(value=>({value}),error=>({error}));
    const second=saveCredentials({key:'SECONDKEY',secret:'SECONDSECRET'}).then(value=>({value}),error=>({error}));
    await atSlow;await second;releaseSlow();await first;
    const current=await loadCredentials();
    assert.equal(current.credentials.key,'FIRSTKEY');
    assert.equal(current.credentials.secret,'FIRSTSECRET');
  } finally {releaseSlow();crypto.subtle.generateKey=generate;crypto.subtle.encrypt=encrypt;}
});

test('encryption input is wiped even when crypto rejects',async()=>{
  globalThis.indexedDB=createFakeIndexedDB();globalThis.chrome=createFakeChromeStorage().chrome;
  const original=crypto.subtle.encrypt;let captured;
  crypto.subtle.encrypt=async(_,key,data)=>{captured=data;throw Error('crypto failed');};
  try {
    await assert.rejects(()=>saveCredentials({key:'KEY',secret:'SECRET'}),/crypto failed/);
    assert(captured && captured.every(byte=>byte===0),'Plaintext bytes retained on crypto failure');
  } finally {crypto.subtle.encrypt=original;}
});

test('an open connection yields to a versionchange request',async()=>{
  let request,closed=0;
  const db={close(){closed++;}};
  globalThis.indexedDB={open(){request={};queueMicrotask(()=>{request.result=db;request.onsuccess();});return request;}};
  const result=await openDatabase('x','items',{open:'open',blocked:'blocked'});
  assert.equal(result,db);db.onversionchange();assert.equal(closed,1);
});

test('transaction setup failures abort scheduled writes instead of committing them',async()=>{
  globalThis.indexedDB=createFakeIndexedDB();
  await assert.rejects(()=>withStore('x','items','readwrite',store=>{
    store.put('partial','key');throw Error('setup failed');
  },{open:'open',blocked:'blocked',transaction:'transaction'}),/setup failed/);
  await tick();assert.equal(indexedDB.inspect('items','x').size,0);
});

test('read success alone cannot finish an eventually aborted transaction',async()=>{
  let tx,request,connection,closed=0,settled=false;
  globalThis.indexedDB={open(){
    const opening={};queueMicrotask(()=>{
      connection={close(){closed++;},transaction(){
        tx={objectStore(){return {get(){request={result:'read'};return request;}};}};return tx;
      }};opening.result=connection;opening.onsuccess();
    });return opening;
  }};
  const outcome=withStore('x','items','readonly',(store,done)=>{
    const read=store.get('key');read.onsuccess=()=>done(read.result);
  },{open:'open',blocked:'blocked',transaction:'aborted'}).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  await tick();request.onsuccess();await tick();assert.equal(settled,false);
  tx.onabort();const result=await outcome;assert(result.error);assert.equal(closed,1);
});

test('failed decrypted JSON validation also clears the plaintext byte buffer',async()=>{
  globalThis.indexedDB=createFakeIndexedDB();globalThis.chrome=createFakeChromeStorage().chrome;
  const saved=await saveCredentials({key:'KEY',secret:'SECRET'});
  const original=crypto.subtle.decrypt;const invalid=new TextEncoder().encode('{"secret":"sensitive","key":42}');
  crypto.subtle.decrypt=async()=>invalid.buffer;
  try {
    await assert.rejects(()=>decryptCredentialRecord(saved.record));
    assert(invalid.every(byte=>byte===0));
  } finally {crypto.subtle.decrypt=original;}
});
