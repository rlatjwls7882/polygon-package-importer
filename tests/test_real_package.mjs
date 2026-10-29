import { installDOMParser } from './helpers/xml.mjs';
import './helpers/i18n.mjs';
// Read-only Polygon ZIP parser test (never calls the Polygon API).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ZipArchive } from '../src/package/zip.js';
import { loadPolygonPackage } from '../src/package/load.js';

const [zipPath,treePath]=process.argv.slice(2);
const tree=JSON.parse(await fs.readFile(treePath,'utf8'));
installDOMParser(tree);
const buf=await fs.readFile(zipPath);
const archive=new ZipArchive(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
const plan=await loadPolygonPackage(archive);
console.log('name',plan.name,'resources',plan.resources.length,'solutions',plan.solutions.length,
  'tests',plan.tests.length,'sources',plan.sources.length,'checker',plan.checker);
console.log('unsupported',plan.unsupported.length);
if(plan.unsupported.length) throw Error('Cannot import: '+plan.unsupported.join('; '));
if(plan.checker==='std::ncmp.cpp') {
  assert.equal(plan.resources.length,7);
  assert.equal(plan.solutions.length,6);
  assert.equal(plan.tests.length,50);
  assert(!plan.resources.some(x=>x.name.startsWith('.')));
  console.log('PASS: actual Polygon-format Linux ZIP: 50 tests, ncmp checker, 7 safe resources, no metadata upload');
}
