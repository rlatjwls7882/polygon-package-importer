import './mock-i18n.mjs';
// Exercise first-run API setup, credential management and ZIP uploading in one popup.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createFakeIndexedDB, createFakeChromeStorage } from './mock-browser-storage.mjs';
import { loadCredentials } from '../credential-store.js';
import { readJob, STATUS_KEY } from '../job-store.js';

const [zipPath, treePath]=process.argv.slice(2);
const tree=JSON.parse(await fs.readFile(treePath,'utf8'));
class FakeNode {
  constructor(data) {
    this.localName=data.tag;
    this.attrs=data.attributes;
    this.children=data.children.map(x=>new FakeNode(x));
    this.textContent=data.text+this.children.map(x=>x.textContent).join('');
  }
  getAttribute(key){return Object.hasOwn(this.attrs,key)?this.attrs[key]:null;}
  hasAttribute(key){return Object.hasOwn(this.attrs,key);}
}
globalThis.DOMParser=class{parseFromString(){return {querySelector:()=>null,documentElement:new FakeNode(tree)}}};

class Element {
  constructor(name) {
    this.id=name;this.handlers={};this.hidden=false;this.disabled=false;
    this.value='';this.textContent='';this.checked=false;this.files=[];
    this.style={};this.className='';
  }
  addEventListener(name,handler){this.handlers[name]=handler;}
}
const ids=(
  'settings closeCredentials credentialPanel credentialTitle credentialStatus '+
  'credentialSetup credentialMigration credentialManage credentialInitHelp credentialFeedback '+
  'retryCredentials saveCredentials migrateCredentials replaceCredentials cancelReplace '+
  'deleteCredentials key secret legacyPassword '+
  'importForm zipFile packageInfo problemIdField problemId commit start '+
  'progressSection progressTitle stateLabel bar jobSummary jobActions retry clearStatus '+
  'logDetails log error'
).split(' ');
let elements, radios;
function buildDOM() {
  elements=Object.fromEntries(ids.map(x=>[x,new Element(x)]));
  for(const name of ['credentialPanel','progressSection','problemIdField','jobActions',
                     'clearStatus','error','settings','closeCredentials','importForm'])
    elements[name].hidden=true;
  radios=[
    Object.assign(new Element('create'),{value:'create',checked:true}),
    Object.assign(new Element('replace'),{value:'replace',checked:false})
  ];
  elements.commit.checked=true;
  elements.start.disabled=true;
  globalThis.document={
    documentElement:{lang:'en'},
    getElementById:name=>{
      if (!elements[name]) throw Error('Missing element: '+name);
      return elements[name];
    },
    querySelector:sel=>sel==='input[name="mode"]:checked'?
      radios.find(r=>r.checked):null,
    querySelectorAll:sel=>sel==='input[name="mode"]'?radios:[]
  };
}
const el=name=>elements[name];
const click=name=>el(name).handlers.click();
globalThis.indexedDB=createFakeIndexedDB();
const storage=createFakeChromeStorage();
globalThis.chrome=storage.chrome;
globalThis.location={protocol:'chrome-extension:'};
let started=0, remoteStatus=null, optionsOpenCount=0, confirmCount=0;
chrome.runtime.openOptionsPage=async()=>{optionsOpenCount++;throw Error('No settings page exists');};
chrome.runtime.sendMessage=async message=>{
  switch(message.type) {
    case 'IMPORT_QUERY':return {ok:true,status:remoteStatus};
    case 'IMPORT_START':
      started++;
      remoteStatus={id:message.jobId,phase:'running',progress:0,
        filename:'fixture.zip',log:['준비 중'],message:'준비 중'};
      await chrome.storage.local.set({[STATUS_KEY]:remoteStatus});
      return {ok:true};
    case 'IMPORT_CLEAR':
      remoteStatus=null;
      await chrome.storage.local.remove(STATUS_KEY);
      return {ok:true};
    default:throw Error('Unknown extension message: '+message.type);
  }
};
globalThis.window={confirm:()=>{confirmCount++;return true;}};

buildDOM();
await import('../popup.js?unified');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(optionsOpenCount,0);
assert(el('importForm').hidden);
assert(!el('credentialPanel').hidden);
assert(!el('credentialSetup').hidden);
assert(el('settings').hidden);
assert(el('credentialStatus').textContent.includes('등록된 API 키가 없습니다'));
console.log('PASS: first-use popup shows API registration inline without opening settings');

await click('saveCredentials');
assert(!el('credentialPanel').hidden);
assert(el('credentialFeedback').textContent.includes('모두 입력'));
console.log('PASS: missing API credentials stay on the inline registration form');

el('key').value='FIRSTKEY';
el('secret').value='FIRSTSECRET';
await click('saveCredentials');
assert((await loadCredentials()).credentials.key==='FIRSTKEY');
assert(!JSON.stringify([...storage.data.values()]).includes('FIRSTSECRET'));
assert.equal(el('key').value,'');
assert.equal(el('secret').value,'');
assert(el('credentialPanel').hidden);
assert(!el('importForm').hidden);
assert(!el('settings').hidden);
assert(el('start').disabled);
console.log('PASS: encrypted API registration immediately reveals ZIP uploader');

const buffer=await fs.readFile(zipPath);
const zipFile={
  name:'fixture.zip',size:buffer.length,
  arrayBuffer:async()=>buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)
};
el('zipFile').files=[zipFile];
await el('zipFile').handlers.change();
assert(el('packageInfo').textContent.includes('테스트 2개'));
assert(!el('start').disabled,'analyzed ZIP should enable upload');
await click('start');
assert.equal(started,1);
assert.equal((await readJob()).filename,'fixture.zip');
assert.equal((await readJob()).file.size,buffer.length);
assert(!el('progressSection').hidden);
assert(el('start').disabled);
console.log('PASS: popup stages ZIP, starts background work, and displays status');

remoteStatus={...remoteStatus,phase:'done',progress:100,message:'완료',log:['준비 중','완료']};
await chrome.storage.local.set({[STATUS_KEY]:remoteStatus});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(el('stateLabel').textContent,'완료');
assert(!el('clearStatus').hidden);
console.log('PASS: status updates reach popup through extension storage');

await click('settings');
assert(!el('credentialPanel').hidden);
assert(el('importForm').hidden);
assert(!el('credentialManage').hidden);
assert(!el('closeCredentials').hidden);
assert(el('progressSection').hidden);
await click('replaceCredentials');
assert(!el('credentialSetup').hidden);
assert(el('credentialTitle').textContent==='API 키 변경');
await click('cancelReplace');
assert(el('credentialSetup').hidden);
await click('closeCredentials');
assert(el('credentialPanel').hidden);
assert(!el('importForm').hidden);
console.log('PASS: registered user manages and cancels API editing without leaving popup');

await click('settings');
await click('replaceCredentials');
el('key').value='SECONDKEY';
el('secret').value='SECONDSECRET';
await click('saveCredentials');
assert((await loadCredentials()).credentials.secret==='SECONDSECRET');
assert(el('credentialPanel').hidden);
assert(!el('importForm').hidden);
assert(el('zipFile').files[0]===zipFile,'API replacement must preserve file selection');
console.log('PASS: API-key replacement saves securely and returns to the uploader');

await click('settings');
await click('deleteCredentials');
assert.equal(confirmCount,1);
assert.equal((await loadCredentials()).credentials,null);
assert(!el('credentialPanel').hidden);
assert(!el('credentialSetup').hidden);
assert(el('importForm').hidden);
assert(el('settings').hidden);
console.log('PASS: deleting API credentials reopens inline registration');

el('key').value='THIRDKEY';
el('secret').value='THIRDSECRET';
await click('saveCredentials');
assert(!el('importForm').hidden);
assert(el('credentialPanel').hidden);
assert.equal(optionsOpenCount,0);
console.log('PASS: re-registration returns to import without ever opening settings');

buildDOM();
await import('../popup.js?reopened');
// Decrypting an already-saved key is asynchronous on a fresh popup.
for(let attempt=0; attempt<40 && !el('credentialPanel').hidden; attempt++)
  await new Promise(resolve=>setTimeout(resolve,10));
assert(el('credentialPanel').hidden);
assert(!el('importForm').hidden);
assert(!el('settings').hidden);
assert.equal(optionsOpenCount,0);
console.log('PASS: a freshly opened popup with stored credentials opens the uploader directly');
