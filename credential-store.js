import { t } from './i18n.js';
import { decryptCredentials, normalizeCredentials, STORE_KEY as LEGACY_KEY } from './credential-vault.js';

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

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error(t('credentialStoreIndexeddbRequestFailed')));
  });
}

async function openDatabase() {
  if (!globalThis.indexedDB) throw Error(t('credentialStoreIndexeddbIsUnavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE))
        request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error(t('credentialStoreFailedToOpenIndexeddb')));
    request.onblocked = () => reject(Error(t('credentialStoreCredentialStorageIsInUseInAnother')));
  });
}

async function readKey() {
  const db = await openDatabase();
  try {
    const tx = db.transaction(DB_STORE, 'readonly');
    return await requestResult(tx.objectStore(DB_STORE).get(DEVICE_KEY));
  } finally {
    db.close();
  }
}

async function updateKey(value, remove = false) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error(t('credentialStoreFailedToReplaceEncryptionKey')));
      tx.onerror = () => reject(tx.error || Error(t('credentialStoreFailedToSaveEncryptionKey')));
      if (remove) tx.objectStore(DB_STORE).delete(DEVICE_KEY);
      else tx.objectStore(DB_STORE).put(value, DEVICE_KEY);
    });
  } finally {
    db.close();
  }
}

async function getOrCreateKey() {
  const current = await readKey();
  if (current) return current;
  const key = await crypto.subtle.generateKey(
    { name:'AES-GCM', length:256 }, false, ['encrypt', 'decrypt']
  );
  await updateKey(key);
  return key;
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
    const credentials = normalizeCredentials(JSON.parse(decoder.decode(data)));
    data.fill(0);
    return credentials;
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
  const ciphertext = await crypto.subtle.encrypt(
    {name:'AES-GCM',iv,additionalData:CONTEXT}, key, data
  );
  data.fill(0);
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
  await updateKey(null, true);
}
