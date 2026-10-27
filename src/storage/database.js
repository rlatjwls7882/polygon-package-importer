// Each operation owns its connection through transaction completion. A rejected
// open request may still succeed later: close that connection instead of leaking it.
export function openDatabase(name, store, errors) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {reject(Error(errors.unavailable || errors.open));return;}
    const request = indexedDB.open(name, 1);
    let settled = false;
    const fail = error => {if (!settled) {settled = true; reject(error);}};
    request.onupgradeneeded = () => {
      if (settled) {request.transaction?.abort();return;}
      if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {db.close();return;}
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => fail(request.error || Error(errors.open));
    request.onblocked = () => fail(Error(errors.blocked));
  });
}

export async function withStore(name, storeName, mode, action, errors) {
  const db = await openDatabase(name, storeName, errors);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let result, failure;
      const fail = error => {
        failure = error;
        try {tx.abort();} catch {reject(error);}
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || Error(errors.transaction));
      // Request errors retain their default abort behavior; success is reported
      // only by oncomplete, never by the success of one intermediate request.
      try {action(tx.objectStore(storeName), value => {result = value;}, fail);}
      catch (error) {fail(error);}
    });
  } finally {db.close();}
}
