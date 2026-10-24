import assert from 'node:assert/strict';
import { createFakeIndexedDB, createFakeChromeStorage } from './mock-browser-storage.mjs';
import { encryptCredentials, STORE_KEY as OLD_KEY } from '../credential-vault.js';
import {
  CREDENTIAL_KEY, initializeCredentials, loadCredentials, saveCredentials,
  migrateCredentials, deleteCredentials
} from '../credential-store.js';

globalThis.indexedDB=createFakeIndexedDB();
const storage=createFakeChromeStorage();
globalThis.chrome=storage.chrome;

await initializeCredentials();
assert.equal(chrome.storage.local.accessLevel,'TRUSTED_CONTEXTS');
assert.deepEqual(await loadCredentials(),{credentials:null,record:null,legacy:false});

const credentials={key:'my-private-api-key',secret:'my-private-secret'};
const saved=await saveCredentials(credentials);
assert.deepEqual(saved.credentials, credentials);
assert.equal(saved.record.version,2);
const payload=JSON.stringify([...storage.data.values()]);
assert(!payload.includes(credentials.key) && !payload.includes(credentials.secret));
const deviceKey=globalThis.indexedDB.inspect().get('local-aes-key');
assert(deviceKey instanceof CryptoKey);
assert.equal(deviceKey.extractable,false);
assert.equal(deviceKey.algorithm.name,'AES-GCM');
console.log('PASS: one-time registration stores ciphertext and a non-extractable device key');

// Simulate another page instance and a browser restart: no password is provided.
const reopened=await loadCredentials();
assert.deepEqual(reopened.credentials,credentials);
assert.deepEqual(reopened.record,saved.record);
console.log('PASS: reopening automatically restores credentials without a password');

await saveCredentials({key:'replacement-key',secret:'replacement-secret'});
assert.equal((await loadCredentials()).credentials.key,'replacement-key');
assert(!JSON.stringify([...storage.data.values()]).includes('replacement-secret'));
await deleteCredentials();
assert.deepEqual(await loadCredentials(),{credentials:null,record:null,legacy:false});
assert.equal(globalThis.indexedDB.inspect().size,0);
console.log('PASS: replacement and deletion clear prior credentials and the key');

// Older versions saved a passphrase-encrypted vault. Migrate it once without
// ever exposing the old API secret to localStorage.
const passphrase='correct horse battery stable 2026';
const legacy=await encryptCredentials(credentials,passphrase);
await chrome.storage.local.set({[OLD_KEY]:legacy});
assert.equal((await loadCredentials()).legacy,true);
await assert.rejects(()=>migrateCredentials('incorrect'),/암호가 일치하지/);
assert.equal((await loadCredentials()).legacy,true);
const migrated=await migrateCredentials(passphrase);
assert.deepEqual(migrated.credentials,credentials);
assert.equal(storage.data.has(OLD_KEY),false);
assert.deepEqual((await loadCredentials()).credentials,credentials);
console.log('PASS: legacy encrypted vault migrates once; wrong password never destroys data');

// Browsing data can be cleared independently; a missing device key fails closed.
globalThis.indexedDB.inspect().clear();
await assert.rejects(()=>loadCredentials(),/암호화 키가 없습니다/);
await deleteCredentials();
console.log('PASS: missing device key never exposes or silently resets secrets');
