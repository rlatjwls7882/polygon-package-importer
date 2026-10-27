export const STATUS_KEY = 'polygonImportStatusV1';

import { withStore } from './database.js';
import { t } from '../i18n.js';
const DATABASE = 'polygon-import-jobs';
const STORE = 'jobs';
const ACTIVE = 'active';

const ZIP = 'activeZip';
const info = record => {
  if (!record) return undefined;
  const {file, storageVersion, ...metadata} = record;
  return metadata;
};

// Both records live in the existing store. Lock/checkpoint updates only touch
// small metadata; replacing/deleting a job updates metadata + ZIP atomically.
function transaction(mode, action) {
  return withStore(DATABASE, STORE, mode, (store, done, fail) => {
    const request = store.get(ACTIVE);
    request.onsuccess = () => {
      try {action(request.result, store, done, fail);}
      catch (error) {fail(error);}
    };
  }, {
    open:t('jobStoreCouldNotOpenJobStorage'), blocked:t('jobStoreJobStorageIsInUseByAnother'),
    transaction:t('jobStoreFailedToSaveJob')
  });
}

export function stageJob(job, expectedId) {
  if (!job?.file || !job?.id) return Promise.reject(Error(t('jobStoreNoZipFileSelected')));
  return transaction('readwrite', (current, store, done) => {
    if (expectedId !== undefined && current?.id !== expectedId) throw Error(t('jobReplaced'));
    if (current?.locked && (current.id !== job.id || expectedId === undefined)) throw Error(t('jobBusy'));
    const metadata = {...info(job), ...(current?.id === job.id && current.locked ? {locked:true} : {})};
    store.put({id:job.id, file:job.file}, ZIP);
    store.put({...metadata, storageVersion:2}, ACTIVE);
    done(metadata);
  });
}

export function readJobInfo() {
  return transaction('readonly', (current, store, done) => done(info(current)));
}

export function readJob() {
  return transaction('readonly', (current, store, done, fail) => {
    if (!current || current.file) {done(current);return;} // Legacy inline-Blob record.
    const request = store.get(ZIP);
    request.onsuccess = () => {
      if (request.result?.id !== current.id || !request.result.file) {fail(Error(t('jobReplaced')));return;}
      done({...info(current), file:request.result.file});
    };
  });
}

function mutateInfo(update) {
  return transaction('readwrite', (current, store, done) => {
    const metadata = info(current), next = update(metadata);
    // Migrate old inline-Blob records lazily and atomically without a database
    // version bump. Existing encrypted credentials are in another database.
    if (next !== undefined) {
      if (current?.file) store.put({id:current.id, file:current.file}, ZIP);
      store.put({...next, storageVersion:2}, ACTIVE);
    }
    done(next);
  });
}

export function patchJob(id, changes) {
  if (Object.keys(changes).some(key => !['mode','problemId','verification'].includes(key)))
    return Promise.reject(Error(t('jobReplaced')));
  return mutateInfo(current => {
    if (current?.id !== id) throw Error(t('jobReplaced'));
    return {...current, ...changes};
  });
}

export function claimJob(id) {
  return mutateInfo(current => {
    if (current?.id !== id) throw Error(t('jobReplaced'));
    if (current.locked) throw Error(t('jobBusy'));
    return {...current, locked:true};
  });
}

export function releaseJob(id) {
  return mutateInfo(current => current?.id === id && current.locked ? {...current, locked:false} : undefined);
}

export function clearJob(id) {
  return transaction('readwrite', (current, store, done) => {
    if (!id || current?.id === id) {store.delete(ACTIVE);store.delete(ZIP);}
    done(undefined);
  });
}
