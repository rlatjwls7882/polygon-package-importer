import { createMockI18n } from './mock-i18n.mjs';
// Minimal IndexedDB and chrome.storage.local mocks for the extension tests.
export function createFakeIndexedDB() {
  const databases = new Map();

  function makeDatabase(name) {
    if (databases.has(name)) return databases.get(name);

    const stores = new Map();
    const db = {
      objectStoreNames: {contains(storeName) {return stores.has(storeName);}},
      createObjectStore(storeName) {stores.set(storeName, new Map());},
      transaction(storeName) {
        if (!stores.has(storeName)) throw Error('Unknown object store: ' + storeName);
        const entries = stores.get(storeName);
        const tx = {
          oncomplete:null, onerror:null, onabort:null, error:null,
          objectStore() {
            return {
              get(key) {
                const request={result:undefined,onsuccess:null,onerror:null};
                queueMicrotask(() => {
                  request.result=entries.get(key);
                  request.onsuccess?.();
                  queueMicrotask(() => tx.oncomplete?.());
                });
                return request;
              },
              put(value,key) {
                const request={result:key};
                queueMicrotask(()=>{
                  entries.set(key,value);
                  tx.oncomplete?.();
                });
                return request;
              },
              delete(key) {
                const request={result:undefined};
                queueMicrotask(()=>{
                  entries.delete(key);
                  tx.oncomplete?.();
                });
                return request;
              }
            };
          }
        };
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
