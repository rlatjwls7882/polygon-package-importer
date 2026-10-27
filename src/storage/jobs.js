export const STATUS_KEY = 'polygonImportStatusV1';

import { t } from '../i18n.js';
const DATABASE = 'polygon-import-jobs';
const STORE = 'jobs';
const ACTIVE = 'active';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error(t('jobStoreCouldNotOpenJobStorage')));
    request.onblocked = () => reject(Error(t('jobStoreJobStorageIsInUseByAnother')));
  });
}

async function operation(mode, callback) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = callback(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onabort = () => reject(transaction.error || Error(t('jobStoreFailedToSaveJob')));
      transaction.onerror = () => reject(transaction.error || Error(t('jobStoreFailedToSaveJob')));
    });
  } finally {
    db.close();
  }
}

// Keep compare/write/delete inside one readwrite transaction across all extension pages.
async function mutateJob(update) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
      let result, failure;
      const request = store.get(ACTIVE);
      request.onsuccess = () => {
        try {
          result = update(request.result);
          if (result === null) store.delete(ACTIVE);
          else if (result !== undefined) store.put(result, ACTIVE);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || Error(t('jobStoreFailedToSaveJob')));
    });
  } finally { db.close(); }
}

// File/Blob stays in IndexedDB rather than being copied into runtime messages.
export async function stageJob(job, expectedId) {
  if (!job?.file || !job?.id) throw Error(t('jobStoreNoZipFileSelected'));
  return mutateJob(current => {
    if (expectedId !== undefined && current?.id !== expectedId) throw Error(t('jobReplaced'));
    if (current?.locked && current.id !== job.id) throw Error(t('jobBusy'));
    return {...job, ...(current?.id === job.id && current.locked ? {locked:true} : {})};
  });
}

export function readJob() {
  return operation('readonly', store => store.get(ACTIVE));
}

export function claimJob(id) {
  return mutateJob(current => {
    if (current?.id !== id) throw Error(t('jobReplaced'));
    if (current.locked) throw Error(t('jobBusy'));
    return {...current, locked:true};
  });
}

export function releaseJob(id) {
  return mutateJob(current => current?.id === id && current.locked ? {...current, locked:false} : undefined);
}

export function clearJob(id) {
  return mutateJob(current => current && (!id || current.id === id) ? null : undefined);
}
