import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePackage } from '../src/package/validate.js';
const plan=()=>({info:{interactive:false},checker:'std::wcmp',checkerPercent:false,groups:[],sources:[],resources:[],aux:[],
  solutions:[{name:'main.cpp',path:'main.cpp',tag:'MA'}],
  tests:[{index:1,method:'manual',path:'shared',outputPath:'shared',sampleInputPath:'shared'}],
  validatorTests:[{index:1,inputPath:'shared'}],checkerTests:[{index:1,inputPath:'shared',outputPath:'shared',answerPath:'shared'}],unsupported:[]});

test('overlapping test, sample and self-test paths are decoded once per validation pass',async()=>{
  const reads=new Map(),p=plan();
  await validatePackage({names:()=>[],text:async path=>{reads.set(path,(reads.get(path)||0)+1);return 'input\n';}},p);
  assert.equal(reads.get('shared'),1);assert.deepEqual(p.unsupported,[]);
});

test('a corrupt shared path is checked once but errors retain every affected test context',async()=>{
  const p=plan();let reads=0;
  await validatePackage({names:()=>[],text:async path=>{if(path==='shared'){reads++;throw Error('CRC mismatch');}return 'source';}},p);
  assert.equal(reads,1);assert(p.unsupported.length>=3);
  assert(p.unsupported.some(text=>text.includes('1')));
});

test('validation keeps the NUL rule for assets even if a path was also referenced as test data',async()=>{
  const p=plan();p.resources=[{name:'resource',path:'shared'}];
  await validatePackage({names:()=>[],text:async path=>path==='shared'?'nul\0byte':'source'},p);
  assert(p.unsupported.some(message=>message.includes('shared')));
});

test('abort errors propagate immediately instead of being cached as an invalid text file',async()=>{
  const p=plan();let reads=0;
  await assert.rejects(()=>validatePackage({names:()=>[],text:async()=>{reads++;throw new DOMException('cancelled','AbortError');}},p),{name:'AbortError'});
  assert.equal(reads,1);
});
