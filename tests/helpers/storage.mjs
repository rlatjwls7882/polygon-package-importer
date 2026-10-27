import { createMockI18n } from './i18n.mjs';
// Minimal IndexedDB and chrome.storage.local mocks for the extension tests.
export function createFakeIndexedDB() {
  const databases = new Map();

  function makeDatabase(name) {
    if (databases.has(name)) return databases.get(name);

    const stores = new Map();
    const db = {
      objectStoreNames: {contains(storeName) {return stores.has(storeName);}},
      createObjectStore(storeName) {stores.set(storeName, new Map());},
      transaction(storeName, mode = 'readonly') {
        if (!stores.has(storeName)) throw Error('Unknown object store: ' + storeName);
        const entries = stores.get(storeName), operations = [];
        let active = false, scheduled = false, finished = false, working, release;
        const before = db.tail || Promise.resolve();
        db.tail = new Promise(resolve => release = resolve);
        function finish(aborted) {
          if (finished) return;
          finished = true;
          if (!aborted && mode === 'readwrite') {
            entries.clear();
            for (const [key,value] of working) entries.set(key,value);
          }
          if (aborted) tx.onabort?.(); else tx.oncomplete?.();
          release();
        }
        function schedule() {
          if (!active || scheduled || finished) return;
          scheduled = true;
          queueMicrotask(() => {
            scheduled = false;
            if (finished) return;
            const operation = operations.shift();
            if (!operation) { finish(false); return; }
            try {
              operation.request.result = operation.run();
              operation.request.onsuccess?.();
            } catch (error) {
              tx.error = error;operation.request.onerror?.();finish(true);
            }
            schedule();
          });
        }
        function request(run) {
          const request={result:undefined,onsuccess:null,onerror:null};
          operations.push({run,request});schedule();return request;
        }
        const tx = {
          oncomplete:null,onerror:null,onabort:null,error:null,
          abort(){finish(true);},
          objectStore(){return {
            get:key=>request(()=>working.get(key)),
            put:(value,key)=>request(()=>{working.set(key,value);return key;}),
            delete:key=>request(()=>working.delete(key))
          };}
        };
        before.then(()=>{active=true;working=new Map(entries);schedule();});
        return tx;
      },
      close() {}
    };
    const state={db,stores,initialized:false};
    databases.set(name,state);
    return state;
  }

  return {
    open(name) {
      const state=makeDatabase(name);
      const request={result:state.db,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
      queueMicrotask(()=>{
        if (!state.initialized) {
          state.initialized=true;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
    inspect(store='keys',database='polygon-package-importer') {
      return databases.get(database)?.stores.get(store);
    }
  };
}

export function createFakeChromeStorage() {
  const data=new Map();
  const listeners=new Set();
  const notify=(key,oldValue,newValue)=>{
    queueMicrotask(()=>listeners.forEach(fn=>fn({[key]:{oldValue,newValue}},'local')));
  };
  return {
    data,
    chrome: {
      i18n:createMockI18n(),
      runtime: {
        id:'abcdefghijklmnopqrstuvwxyzabcdef',
        getManifest:()=>({permissions:['storage']})
      },
      storage: {
        onChanged: {addListener(fn){listeners.add(fn);}},
        local: {
          accessLevel:null,
          async setAccessLevel({accessLevel}){this.accessLevel=accessLevel;},
          async get(keys){
            const list=keys==null?[...data.keys()]:Array.isArray(keys)?keys:[keys];
            return Object.fromEntries(list.filter(k=>data.has(k)).map(k=>[k,data.get(k)]));
          },
          async set(values) {
            for(const [k,v] of Object.entries(values)){
              const old=data.get(k);data.set(k,v);notify(k,old,v);
            }
          },
          async remove(keys) {
            for(const k of Array.isArray(keys)?keys:[keys]){
              const old=data.get(k);data.delete(k);notify(k,old,undefined);
            }
          }
        }
      }
    }
  };
}
