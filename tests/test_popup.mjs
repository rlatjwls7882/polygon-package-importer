import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createFakeIndexedDB, createFakeChromeStorage } from './mock-browser-storage.mjs';
import { saveCredentials } from '../credential-store.js';
import { readJob } from '../job-store.js';
import { STATUS_KEY } from '../status.js';

const [zipPath, treePath]=process.argv.slice(2);
const tree=JSON.parse(await fs.readFile(treePath,'utf8'));
class FakeNode {
  constructor(data){
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
    this.value='';this.textContent='';this.checked=false;this.files=[];this.style={};
  }
  addEventListener(name,handler){this.handlers[name]=handler;}
}
const ids='settings openSetup needSetup importForm zipFile packageInfo problemIdField problemId commit start progressSection progressTitle stateLabel bar jobSummary jobActions retry clearStatus logDetails log error'.split(' ');

let elements, radios;
function buildDOM() {
  elements=Object.fromEntries(ids.map(x=>[x,new Element(x)]));
  for(const name of ['needSetup','progressSection','problemIdField','jobActions','clearStatus','error'])
    elements[name].hidden=true;
  radios=[
    Object.assign(new Element('create'),{value:'create',checked:true}),
    Object.assign(new Element('replace'),{value:'replace',checked:false})
  ];
  elements.commit.checked=true;
  elements.start.disabled=true;
  globalThis.document={
    getElementById:name=>elements[name],
    querySelector:sel=>sel==='input[name="mode"]:checked'?
      radios.find(r=>r.checked):null,
    querySelectorAll:sel=>sel==='input[name="mode"]'?radios:[]
  };
}
function el(name){return elements[name];}
globalThis.indexedDB=createFakeIndexedDB();
const storage=createFakeChromeStorage();
globalThis.chrome=storage.chrome;
let openCount=0, closed=0, started=0, remoteStatus=null;
chrome.runtime.openOptionsPage=async()=>{openCount++;};
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
globalThis.window={close:()=>{closed++;}};

buildDOM();
await import('../popup.js?first');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(openCount,1);
assert.equal(closed,1);
assert(el('importForm').hidden);
assert(!el('needSetup').hidden);
console.log('PASS: first-use popup redirects to the API settings page');

await saveCredentials({key:'KEY',secret:'SECRET'});
buildDOM();
await import('../popup.js?registered');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(openCount,1);
assert(!el('importForm').hidden);
assert(el('needSetup').hidden);
assert(el('start').disabled);
console.log('PASS: registered user sees popup without opening another page');

const buffer=await fs.readFile(zipPath);
const zipFile={
  name:'fixture.zip',size:buffer.length,
  arrayBuffer:async()=>buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)
};
el('zipFile').files=[zipFile];
await el('zipFile').handlers.change();
assert(el('packageInfo').textContent.includes('테스트 2개'));
assert(!el('start').disabled,'analyzed ZIP should enable upload');
await el('start').handlers.click();
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
