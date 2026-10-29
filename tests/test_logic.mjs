import { installDOMParser } from './helpers/xml.mjs';
import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {ZipArchive} from '../src/package/zip.js';
import {loadPolygonPackage} from '../src/package/load.js';
import {PolygonAPI} from '../src/polygon/api.js';

const path=process.argv[2];
let xmlTree=JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
installDOMParser(() => xmlTree);

const filebytes=await fs.readFile(path);
const zip=new ZipArchive(filebytes.buffer.slice(filebytes.byteOffset,filebytes.byteOffset+filebytes.byteLength));
assert.deepEqual((await zip.text('tests/01')), '1\n');
assert((await zip.text('problem.xml')).includes('demo-import'));
const plan=await loadPolygonPackage(zip);
assert.equal(plan.name,'demo-import');
assert.deepEqual(plan.statements.map(x=>x.lang),['english']);
assert.equal(plan.sources.length,2);
assert.equal(plan.resources.length,1);
assert.equal(plan.solutions.length,1);
assert.equal(plan.tests.length,2);
assert.equal(plan.tests[0].path,'tests/01');
assert.equal(plan.tests[0].outputPath,'tests/01.a');
assert.equal(plan.tests[1].cmd,'gen 99');
assert.equal(plan.tests[1].method,'generated');
assert.equal(plan.validator,'val.cpp');
assert.equal(plan.checker,'std::wcmp');
assert.deepEqual(plan.unsupported,[]);
assert(!plan.resources.some(x => x.name.startsWith('.')));
const conflict = await fs.readFile(process.argv[4]);
const badzip = new ZipArchive(conflict.buffer.slice(conflict.byteOffset, conflict.byteOffset + conflict.byteLength));
const badplan = await loadPolygonPackage(badzip);
assert(badplan.unsupported.some(x => x.includes('testlib.h') && x.includes('내용 충돌')));
const badMarkerBuffer=await fs.readFile(process.argv[5]);
const badMarkerZip=new ZipArchive(badMarkerBuffer.buffer.slice(badMarkerBuffer.byteOffset,badMarkerBuffer.byteOffset+badMarkerBuffer.byteLength));
const badMarkerPlan=await loadPolygonPackage(badMarkerZip);
assert(badMarkerPlan.unsupported.includes('패키지의 Checker 선택 메타데이터를 검증할 수 없습니다. Checker 설정을 확인하세요.'));
const safeTree=xmlTree;
xmlTree=JSON.parse(await fs.readFile(process.argv[7],'utf8'));
const badNameBuffer=await fs.readFile(process.argv[6]);
const badNameZip=new ZipArchive(badNameBuffer.buffer.slice(badNameBuffer.byteOffset,badNameBuffer.byteOffset+badNameBuffer.byteLength));
const badNamePlan=await loadPolygonPackage(badNameZip);
assert(badNamePlan.unsupported.some(x=>x.includes('파일명') && x.includes('.unknown-resource')));
xmlTree=safeTree;
console.log('PASS: ZIP, duplicate headers, verified checker metadata skip, mismatched marker and unknown dotfile rejection');

const requests=[];
globalThis.fetch=async function(url, req) {
  const p=new URLSearchParams(req.body);
  const signature=p.get('apiSig'); p.delete('apiSig');
  const params=[...p].sort(([a,x],[b,y])=>(a<b?-1:a>b?1:x<y?-1:x>y?1:0));
  const method=url.split('/').pop();
  const value=signature.slice(0,6)+'/'+method+'?'+params.map(([a,b])=>a+'='+b).join('&')+'#SECRET';
  assert.equal(crypto.createHash('sha512').update(value).digest('hex'),signature.slice(6));
  assert.equal(req.credentials,'omit');
  requests.push({method,params:Object.fromEntries(params)});
  return new Response(JSON.stringify({status:'OK',result:{id:21}}),{status:200,headers:{'content-type':'application/json'}});
};
const api=new PolygonAPI(' KEY ',' SECRET ');
await api.call('problem.create',{name:'one'});
await api.problem('saveStatement',21,{lang:'english',legend:'한글 & %= test'});
assert(!Object.hasOwn(requests[0].params,'pin'));
assert(!Object.hasOwn(requests[1].params,'pin'));
assert.equal(requests[1].params.legend,'한글 & %= test');
console.log('PASS: official Polygon SHA-512 signature, unicode parameters, and no PIN parameter');
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>new Response(JSON.stringify({status:'FAILED',comment:'bad credentials: KEY SECRET'}),
  {status:400,headers:{'content-type':'application/json'}});
await assert.rejects(() => api.call('problems.list'), e =>
  e.message.includes('[비공개]') &&
  !e.message.includes('KEY') && !e.message.includes('SECRET'));
globalThis.fetch=originalFetch;
api.sessionActive=()=>false;
await assert.rejects(() => api.call('problems.list'), /보관함이 잠겨/);
console.log('PASS: sensitive values removed from API failure messages; revoked sessions cannot make new requests');
