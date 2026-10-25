import assert from 'node:assert/strict';
import { CredentialsUI } from '../credentials-ui.js';
import { createFakeIndexedDB, createFakeChromeStorage } from './mock-browser-storage.mjs';

class Element {
  constructor() {
    this.handlers={}; this.hidden=false; this.disabled=false;
    this.value='';this.textContent='';this.className='';
  }
  addEventListener(type,handler) {this.handlers[type]=handler;}
}

const names = [
  'credentialSetup', 'credentialMigration', 'credentialManage',
  'credentialInitHelp','credentialFeedback','credentialStatus',
  'retryCredentials','saveCredentials','migrateCredentials',
  'replaceCredentials','cancelReplace','deleteCredentials',
  'key','secret','legacyPassword'
];
const elements=Object.fromEntries(names.map(name=>[name,new Element()]));
globalThis.document={getElementById:name=>{
  if(!elements[name]) throw Error('Missing element: '+name);
  return elements[name];
}};
globalThis.location={protocol:'file:'};
globalThis.chrome=undefined;
globalThis.indexedDB=createFakeIndexedDB();

const ui=new CredentialsUI();
await ui.init();
assert.equal(ui.state,'error');
assert(elements.credentialStatus.textContent.includes('Chrome 확장 프로그램 팝업'));
assert(!elements.credentialInitHelp.hidden);
assert(elements.credentialSetup.hidden);
console.log('PASS: direct file:// access is rejected');

globalThis.location.protocol='chrome-extension:';
await elements.retryCredentials.handlers.click();
assert.equal(ui.state,'error');
assert(elements.credentialStatus.textContent.includes('Chrome 확장 프로그램 저장소'));
console.log('PASS: missing Chrome storage API is explained');

globalThis.chrome=createFakeChromeStorage().chrome;
chrome.storage.local.setAccessLevel=async()=>{throw Error('storage permission denied');};
await elements.retryCredentials.handlers.click();
assert.equal(ui.state,'error');
assert(elements.credentialStatus.textContent.includes('storage permission denied'));
console.log('PASS: storage access failure is visible');

chrome.storage.local.setAccessLevel=async()=>{};
chrome.storage.local.get=async()=>{throw Error('read failed');};
await elements.retryCredentials.handlers.click();
assert.equal(ui.state,'error');
assert(elements.credentialStatus.textContent.includes('read failed'));
console.log('PASS: storage read errors are visible');

chrome.storage.local.get=async()=>({});
await elements.retryCredentials.handlers.click();
assert.equal(ui.state,'empty');
assert(!elements.credentialSetup.hidden);
assert(elements.credentialInitHelp.hidden);
console.log('PASS: retry succeeds once storage becomes available');
