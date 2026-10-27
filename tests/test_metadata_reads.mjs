import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyFileMetadata } from '../src/polygon/file-metadata.js';
const plan=()=>({sources:[],solutions:[],resources:[],aux:[]});
const read=(_,task)=>task();

test('resource-only metadata validation does not fetch the unrelated solutions listing',async()=>{
  const p=plan(),calls=[];p.resources=[{name:'grader.cpp',resourceAdvancedProperties:null}];
  await verifyFileMetadata({id:42,plan:p,read,api:{problem:async method=>{
    calls.push(method);return method==='files'?{sourceFiles:[],resourceFiles:[{name:'grader.cpp'}],auxFiles:[]}:[];
  }}});
  assert.deepEqual(calls,['files']);
});

test('solution-only compiler validation does not fetch the unrelated file listing',async()=>{
  const p=plan(),calls=[];p.solutions=[{name:'main.cpp',sourceType:'cpp.g++20'}];
  await verifyFileMetadata({id:42,plan:p,read,api:{problem:async method=>{
    calls.push(method);return method==='solutions'?[{name:'main.cpp',sourceType:'cpp.g++20'}]:{sourceFiles:[],resourceFiles:[],auxFiles:[]};
  }}});
  assert.deepEqual(calls,['solutions']);
});

test('a failed file-metadata response does not enqueue the next solution query',async()=>{
  const p=plan(),calls=[];p.sources=[{name:'gen.cpp',sourceType:'cpp.g++20'}];p.solutions=[{name:'main.cpp',sourceType:'cpp.g++20'}];
  await assert.rejects(()=>verifyFileMetadata({id:42,plan:p,read,api:{problem:async method=>{
    calls.push(method);if(method==='files')throw Error('network');return [];
  }}}));
  assert.deepEqual(calls,['files']);
});

test('duplicate server file names cannot be hidden by Map overwrites during validation',async()=>{
  const p=plan();p.sources=[{name:'gen.cpp',sourceType:'cpp.g++20'}];
  await assert.rejects(()=>verifyFileMetadata({id:42,plan:p,read,api:{problem:async method=>
    method==='files'?{sourceFiles:[{name:'gen.cpp',sourceType:'cpp.g++17'},{name:'gen.cpp',sourceType:'cpp.g++20'}],resourceFiles:[],auxFiles:[]}:[]}}));
});


test('untyped solutions still have their existence checked when files are verified',async()=>{
  const p=plan();p.sources=[{name:'gen.cpp',sourceType:'cpp.g++20'}];p.solutions=[{name:'main.cpp'}];
  await assert.rejects(()=>verifyFileMetadata({id:42,plan:p,read,api:{problem:async method=>
    method==='files'?{sourceFiles:[{name:'gen.cpp',sourceType:'cpp.g++20'}],resourceFiles:[],auxFiles:[]}:[]}}));
});

test('all required metadata is checked before success, including a changed compiler',async()=>{
  const p=plan();p.solutions=[{name:'main.cpp',sourceType:'cpp.g++20'}];
  await assert.rejects(()=>verifyFileMetadata({id:42,plan:p,read,api:{problem:async()=>[{name:'main.cpp',sourceType:'cpp.g++17'}]}}));
});
