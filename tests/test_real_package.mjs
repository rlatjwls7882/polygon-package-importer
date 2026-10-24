// Read-only Polygon ZIP parser test (never calls the Polygon API).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ZipArchive } from '../zip.js';
import { loadPolygonPackage } from '../model.js';

class FakeNode {
  constructor(v) {
    this.localName=v.tag;
    this.attrs=v.attributes;
    this.children=v.children.map(c=>new FakeNode(c));
    this.textContent=v.text+this.children.map(c=>c.textContent).join('');
  }
  getAttribute(name) {return Object.hasOwn(this.attrs,name)?this.attrs[name]:null;}
  hasAttribute(name) {return Object.hasOwn(this.attrs,name);}
}
const [zipPath,treePath]=process.argv.slice(2);
const tree=JSON.parse(await fs.readFile(treePath,'utf8'));
globalThis.DOMParser=class {
  parseFromString(xml) {
    assert(xml.includes('<problem'), 'Invalid problem.xml');
    return {querySelector:()=>null,documentElement:new FakeNode(tree)};
  }
};
const buf=await fs.readFile(zipPath);
const archive=new ZipArchive(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
const plan=await loadPolygonPackage(archive);
console.log('name',plan.name,'resources',plan.resources.length,'solutions',plan.solutions.length,
  'tests',plan.tests.length,'sources',plan.sources.length,'checker',plan.checker);
console.log('warnings',plan.warnings.length,'unsupported',plan.unsupported.length);
for(const warning of plan.warnings.filter(x=>x.includes('Checker 선택 메타데이터')))
  console.log('metadata filtered: ',warning);
if(plan.unsupported.length) throw Error('Cannot import: '+plan.unsupported.join('; '));
if(plan.checker==='std::ncmp.cpp') {
  assert.equal(plan.resources.length,7);
  assert.equal(plan.solutions.length,6);
  assert.equal(plan.tests.length,50);
  assert(!plan.resources.some(x=>x.name.startsWith('.')));
  assert(plan.warnings.some(x=>x.includes('SOJ 전용 Checker 선택 메타데이터')));
  console.log('PASS: actual SOJ Linux ZIP: 50 tests, ncmp checker, 7 safe resources, no metadata upload');
}
