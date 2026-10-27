export const STATUS_KEY = 'polygonImportStatusV1';

import { t } from './i18n.js';
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

// Store the original File using IndexedDB's structured clone rather than
// encoding megabytes of ZIP data into Chrome runtime messages.
export async function stageJob(job) {
  if (!job?.file || !job?.id) throw Error(t('jobStoreNoZipFileSelected'));
  return operation('readwrite', store => store.put(job, ACTIVE));
}

export function readJob() {
  return operation('readonly', store => store.get(ACTIVE));
}

export async function clearJob(jobId) {
  const current = await readJob();
  if (current && (!jobId || current.id === jobId)) {
    await operation('readwrite', store => store.delete(ACTIVE));
  }
}
