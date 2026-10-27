import './mock-i18n.mjs';
import assert from 'node:assert/strict';
import { createFakeIndexedDB } from './mock-browser-storage.mjs';
import { stageJob, readJob, clearJob } from '../job-store.js';

globalThis.indexedDB = createFakeIndexedDB();
const file = new Blob(['PK\x03\x04fake zip'], {type:'application/zip'});
const saved = {
  id:'test-job-1', filename:'problem.zip', file,
  mode:'replace', problemId:'598703', commit:true
};
await stageJob(saved);
const restored=await readJob();
assert.equal(restored.id, saved.id);
assert.equal(restored.file.size, file.size);
assert.equal(restored.problemId,'598703');
console.log('PASS: selected ZIP blob is retained across popup lifetime in IndexedDB');

// Once Polygon creates an ID, changing the stored job to 'replace' preserves
// the ZIP so an interrupted upload never creates a duplicate problem.
await stageJob({...restored, mode:'create', problemId:null});
await stageJob({...await readJob(), mode:'replace', problemId:'583386'});
const resumed=await readJob();
assert.equal(resumed.problemId,'583386');
assert.equal(resumed.file.size,file.size);
console.log('PASS: created problem ID survives job updates with the ZIP intact');

await clearJob('other-job');
assert((await readJob())?.file);
await clearJob(saved.id);
assert.equal(await readJob(), undefined);
console.log('PASS: clearing a completed job removes only the intended ZIP');
