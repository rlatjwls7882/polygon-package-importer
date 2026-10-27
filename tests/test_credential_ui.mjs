import './mock-i18n.mjs';
import assert from 'node:assert/strict';
import { createFakeIndexedDB, createFakeChromeStorage } from './mock-browser-storage.mjs';
import { CredentialsUI } from '../credentials-ui.js';
import { encryptCredentials, STORE_KEY as LEGACY_KEY } from '../credential-vault.js';

globalThis.indexedDB=createFakeIndexedDB();
const browser=createFakeChromeStorage();
globalThis.chrome=browser.chrome;
globalThis.window={confirm:()=>true};

class Element {
  constructor() {
    this.handlers={};this.hidden=false;this.disabled=false;
    this.value='';this.textContent='';this.className='';
  }
  addEventListener(type,handler){this.handlers[type]=handler;}
}
const names=[
  'credentialSetup','credentialMigration','credentialManage','credentialInitHelp',
  'credentialFeedback','credentialStatus','retryCredentials','saveCredentials',
  'migrateCredentials','replaceCredentials','cancelReplace','deleteCredentials',
  'key','secret','legacyPassword'
];
const elements=Object.fromEntries(names.map(k=>[k,new Element()]));
globalThis.document={getElementById:id=>elements[id]};
const $=id=>elements[id.replace(/^#/, '')];

const credentials={key:'KEYVALUE123',secret:'SECRETVALUE456'};
const legacyPassword='a long legacy passphrase';
await chrome.storage.local.set({[LEGACY_KEY]:await encryptCredentials(credentials,legacyPassword)});

const { loadCredentials } = await import('../credential-store.js');
const first=new CredentialsUI();
await first.init();
assert.equal(first.state,'legacy');
assert(!$('#credentialMigration').hidden);
assert($('#credentialSetup').hidden);

$('#legacyPassword').value='bad password';
await $('#migrateCredentials').handlers.click();
assert.equal(first.state,'legacy');
assert(browser.data.has(LEGACY_KEY));

$('#legacyPassword').value=legacyPassword;
await $('#migrateCredentials').handlers.click();
assert.equal(first.state,'ready');
assert.equal((await loadCredentials()).credentials.secret,credentials.secret);
assert(!browser.data.has(LEGACY_KEY));
assert($('#credentialMigration').hidden);
assert($('#credentialStatus').textContent.includes('API 키 등록됨'));
console.log('PASS: prior vault migrates after one password entry');

// A fresh page instance can immediately use the credentials.
const reopened=new CredentialsUI();
await reopened.init();
assert.equal(reopened.state,'ready');
assert.deepEqual((await loadCredentials()).credentials,credentials);
assert($('#credentialSetup').hidden && $('#credentialMigration').hidden);
assert(!$('#credentialManage').hidden);
assert(!$('#credentialStatus').textContent.includes(credentials.secret));
console.log('PASS: fresh extension page resumes automatically without password');

const previousRecord=first.record;
$('#replaceCredentials').handlers.click();
assert.equal(reopened.editing,true);
$('#key').value='UPDATEDKEY';
$('#secret').value='UPDATEDSECRET';
await $('#saveCredentials').handlers.click();
assert.equal((await loadCredentials()).credentials.secret,'UPDATEDSECRET');
assert(!JSON.stringify([...browser.data.values()]).includes('UPDATEDSECRET'));
await new Promise(resolve=>setImmediate(resolve));
assert.notEqual(first.record.iv, previousRecord.iv);
assert.equal((await loadCredentials()).credentials.secret,'UPDATEDSECRET');
console.log('PASS: replacement keeps plaintext out of storage and updates other open tabs');

await $('#deleteCredentials').handlers.click();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(reopened.state,'empty');
assert.equal(browser.data.size,0);
assert.equal(indexedDB.inspect().size,0);
assert(!$('#credentialSetup').hidden);
console.log('PASS: delete clears saved credentials, including the IndexedDB CryptoKey');
