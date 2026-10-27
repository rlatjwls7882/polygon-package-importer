import { withStore } from './database.js';
import { t } from '../i18n.js';
import { decryptCredentials, normalizeCredentials, STORE_KEY as LEGACY_KEY } from './legacy-vault.js';

export const CREDENTIAL_KEY = 'polygonCredentialsV2';

const DB_NAME = 'polygon-package-importer';
const DB_STORE = 'keys';
const DEVICE_KEY = 'local-aes-key';
const CONTEXT = new TextEncoder().encode('polygon-package-importer/v2');
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function toBase64(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(value) {
  if (typeof value !== 'string' || value.length > 32768) throw Error(t('credentialStoreStoredCredentialsAreInvalid'));
  return Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
}

function keyTransaction(mode, action) {
  return withStore(DB_NAME, DB_STORE, mode, action, {
    unavailable:t('credentialStoreIndexeddbIsUnavailable'), open:t('credentialStoreFailedToOpenIndexeddb'),
    blocked:t('credentialStoreCredentialStorageIsInUseInAnother'),
    transaction:t('credentialStoreFailedToSaveEncryptionKey')
  });
}

function readKey() {
  return keyTransaction('readonly', (store, done) => {
    const request = store.get(DEVICE_KEY);
    request.onsuccess = () => done(request.result);
  });
}

function removeKey() {
  return keyTransaction('readwrite', store => {store.delete(DEVICE_KEY);});
}

async function getOrCreateKey() {
  const current = await readKey();
  if (current) return current;
  // WebCrypto cannot be awaited inside an active IndexedDB transaction.
  const candidate = await crypto.subtle.generateKey(
    {name:'AES-GCM', length:256}, false, ['encrypt', 'decrypt']
  );
  return keyTransaction('readwrite', (store, done, fail) => {
    const request = store.get(DEVICE_KEY);
    request.onsuccess = () => {
      try {
        if (request.result) done(request.result);
        else {store.put(candidate, DEVICE_KEY);done(candidate);}
      } catch (error) {fail(error);}
    };
  });
}

export function sameRecord(a, b) {
  return !!a && !!b && a.version === 2 && b.version === 2 &&
    a.iv === b.iv && a.ciphertext === b.ciphertext;
}

export async function initializeCredentials() {
  if (!globalThis.chrome?.storage?.local?.setAccessLevel)
    throw Error(t('credentialStoreChromeExtensionStorageIsUnavailable'));
  await chrome.storage.local.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' });
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB)
    throw Error(t('credentialStoreEncryptionOrIndexeddbIsUnavailable'));
}

export async function decryptCredentialRecord(record) {
  if (!record || record.version !== 2 || typeof record.iv !== 'string' ||
      typeof record.ciphertext !== 'string')
    throw Error(t('credentialStoreStoredApiCredentialsHaveAnInvalidFormat'));

  const key = await readKey();
  if (!key) throw Error(t('credentialStoreThisBrowserProfileHasNoEncryptionKey'));
  try {
    const iv = fromBase64(record.iv);
    if (iv.length !== 12) throw Error(t('credentialStoreInvalidIv'));
    const ciphertext = fromBase64(record.ciphertext);
    const data = new Uint8Array(await crypto.subtle.decrypt(
      {name:'AES-GCM', iv, additionalData:CONTEXT}, key, ciphertext
    ));
    try {return normalizeCredentials(JSON.parse(decoder.decode(data)));}
    finally {data.fill(0);}
  } catch {
    throw Error(t('credentialStoreDecryptionFailed'));
  }
}

export async function loadCredentials() {
  const stored = await chrome.storage.local.get([CREDENTIAL_KEY, LEGACY_KEY]);
  const record = stored[CREDENTIAL_KEY];
  if (!record) return { credentials:null, record:null, legacy:!!stored[LEGACY_KEY] };
  return {credentials:await decryptCredentialRecord(record), record, legacy:false};
}

export async function saveCredentials(credentials) {
  const value = normalizeCredentials(credentials);
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify(value));
  let ciphertext;
  try {ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:CONTEXT}, key, data);}
  finally {data.fill(0);}
  const record = {version:2, iv:toBase64(iv), ciphertext:toBase64(new Uint8Array(ciphertext))};
  await chrome.storage.local.set({[CREDENTIAL_KEY]:record});
  const verified = await loadCredentials();
  if (!sameRecord(verified.record, record)) throw Error(t('credentialStoreCouldNotVerifyTheSavedCredentials'));
  return verified;
}

export async function migrateCredentials(passphrase) {
  const existing = await chrome.storage.local.get(LEGACY_KEY);
  if (!existing[LEGACY_KEY]) throw Error(t('credentialStorePreviousCredentialsWereNotFound'));
  const credentials = await decryptCredentials(existing[LEGACY_KEY], passphrase);
  const result = await saveCredentials(credentials);
  await chrome.storage.local.remove(LEGACY_KEY);
  return result;
}

export async function deleteCredentials() {
  await chrome.storage.local.remove([CREDENTIAL_KEY, LEGACY_KEY]);
  await removeKey();
}
