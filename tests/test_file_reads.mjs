import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { ZipArchive } from '../src/package/zip.js';
import { makeZip } from './helpers/zip.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('cancelled analysis stops the original File read, not just later decompression',async()=>{
  const data=makeZip({'problem.xml':'<problem/>'});let release,entered,cancelled=0,settled=false;
  const gate=new Promise(resolve=>release=resolve),waiting=new Promise(resolve=>entered=resolve);
  const file={size:data.byteLength,
    stream:()=>new ReadableStream({async pull(){entered();await gate;},cancel(){cancelled++;}}),
    async arrayBuffer(){entered();await gate;return data;}};
  const controller=new AbortController();
  const result=ZipArchive.fromFile(file,{signal:controller.signal}).then(archive=>{settled=true;archive.dispose();return null;},error=>{settled=true;return error;});
  try {await waiting;controller.abort();await tick();assert(settled,'Still waiting for a cancelled file read');assert.equal(cancelled,1);assert.equal((await result).name,'AbortError');}
  finally {release();await result;}
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('native Blob streaming preserves bytes and rejects truncated or oversized input streams',async()=>{
  const data=makeZip({'problem.xml':'<problem/>','data':'hello'});
  const archive=await ZipArchive.fromFile(new Blob([data]));assert.equal(await archive.text('data'),'hello');archive.dispose();
  for(const difference of [-1,1]) {
    const file={size:data.byteLength+difference,stream:()=>new Blob([data]).stream(),arrayBuffer:async()=>data};
    await assert.rejects(()=>ZipArchive.fromFile(file));
  }
});
