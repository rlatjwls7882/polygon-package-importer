import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeZip } from './helpers/zip.mjs';
import { ZipArchive } from '../src/package/zip.js';

test('ZIP reads share bounded cached decompression without exposing mutable cache bytes', async () => {
  const native=globalThis.DecompressionStream;let count=0;
  globalThis.DecompressionStream=class {constructor(format){count++;return new native(format);}};
  try {
    const archive=new ZipArchive(makeZip({'problem.xml':'<problem/>','data.txt':'hello\n'}));
    await Promise.all(Array.from({length:8},()=>archive.text('data.txt')));
    const data=await archive.bytes('data.txt');data[0]=120;
    assert.equal(await archive.text('data.txt'),'hello\n');
    assert.equal((await archive.bytes('data.txt'))[0],104);
    assert.equal(count,1,'Repeated/concurrent reads must inflate only once');
  } finally {globalThis.DecompressionStream=native;}
});

test('forged uncompressed size is enforced during streaming, not after full inflation', async () => {
  const native=globalThis.DecompressionStream;let delivered=0;
  globalThis.DecompressionStream=class {
    constructor(format){const stream=new native(format);this.writable=stream.writable;
      this.readable=stream.readable.pipeThrough(new TransformStream({transform(chunk,controller){delivered+=chunk.length;controller.enqueue(chunk);}}));}
  };
  try {
    const actual=2*1024*1024;
    const archive=new ZipArchive(makeZip({'problem.xml':'<problem/>','huge.txt':'a'.repeat(actual)},
      {declaredSize:{'huge.txt':1024}}));
    await assert.rejects(()=>archive.bytes('huge.txt'));
    assert(delivered<actual/2,'Stop a bogus stream before allocating its whole output');
  } finally {globalThis.DecompressionStream=native;}
});

test('cache eviction is bounded and corrupted CRC results are never cached',async()=>{
  const native=globalThis.DecompressionStream;let count=0;
  globalThis.DecompressionStream=class {constructor(format){count++;return new native(format);}};
  try {
    const data=makeZip({'problem.xml':'<problem/>','one':'a'.repeat(40),'two':'b'.repeat(40)});
    const archive=new ZipArchive(data,{cacheLimit:130});
    await archive.text('one');await archive.text('two');await archive.text('one');
    assert.equal(count,3);assert(archive.cacheBytes<=130);
    const broken=makeZip({'problem.xml':'<problem/>','bad':'corrupt'});
    const bytes=new Uint8Array(broken),dv=new DataView(broken);
    for(let i=0;i+46<=bytes.length;i++)if(dv.getUint32(i,true)===0x02014b50 && dv.getUint16(i+28,true)===3){dv.setUint32(i+16,0,true);break;}
    const invalid=new ZipArchive(broken);const before=count;
    await assert.rejects(()=>invalid.text('bad'));await assert.rejects(()=>invalid.text('bad'));
    assert.equal(count-before,2);assert.equal(invalid.cacheBytes,0);
  } finally {globalThis.DecompressionStream=native;}
});

test('truncated central directories produce a controlled localized error',()=>{
  const buffer=makeZip({'problem.xml':'<problem/>'}),dv=new DataView(buffer);
  const end=buffer.byteLength-22;
  dv.setUint32(end+16,buffer.byteLength-1,true);dv.setUint32(end+12,0,true);
  assert.throws(()=>new ZipArchive(buffer),error=>!(error instanceof RangeError));
});
