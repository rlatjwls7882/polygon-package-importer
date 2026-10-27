import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textByteRange } from '../src/package/text.js';
import { sameText } from '../src/polygon/compare.js';
import { syncFiles } from '../src/polygon/files.js';

const normalize=value=>value.replace(/\r\n?/g,'\n');
test('text equality keeps exact EOL semantics without allocating normalized copies',()=>{
  const old=String.prototype.replace;let replacements=0;
  String.prototype.replace=function(...args){replacements++;return old.apply(this,args);};
  try {
    assert(sameText('line\r\n'.repeat(5000),'line\n'.repeat(5000)));
    assert.equal(replacements,0);
  } finally {String.prototype.replace=old;}
});

test('file length screening does not allocate a complete UTF-8 buffer or line array',async()=>{
  const oldEncode=TextEncoder.prototype.encode,oldSplit=String.prototype.split;
  const text='// test\r\n'.repeat(5000),calls=[];let encoded=0,splits=0;
  TextEncoder.prototype.encode=function(value){encoded++;return oldEncode.call(this,value);};
  String.prototype.split=function(...args){splits++;return oldSplit.apply(this,args);};
  try {
    await syncFiles({api:{problem:async(method)=>{calls.push(method);return text;}},id:42,
      plan:{sources:[{name:'a.cpp',path:'a.cpp'}],resources:[],aux:[],solutions:[]},
      archive:{text:async()=>text},target:{files:{sourceFiles:[{name:'a.cpp',length:text.length}]}},
      read:(_,fn)=>fn(),apply:()=>assert.fail('Unchanged source was uploaded'),unchanged:()=>{}});
    assert.equal(encoded,0);assert.equal(splits,0);assert.deepEqual(calls,['viewFile']);
  } finally {TextEncoder.prototype.encode=oldEncode;String.prototype.split=oldSplit;}
});

test('line-ending equality agrees with a reference across Unicode and malformed UTF-16',()=>{
  const alphabet=['a','\r','\n','\uFFFD','\uFEFF','한','😀','\ud800','\udfff'];
  const samples=['','\r\r\n','a\n','a\r\n','a'];
  let seed=20261027;
  for(let i=0;i<100;i++){
    let s='';for(let j=0;j<20;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;s+=alphabet[seed%alphabet.length];}samples.push(s);
  }
  for(const a of samples)for(const b of samples)assert.equal(sameText(a,b),normalize(a)===normalize(b));
  assert.equal(sameText(null,''),false);
});

test('UTF-8 length bounds match native encoding including CRLF and lone surrogates',()=>{
  const samples=['','ascii','한글😀','\ud800','\udfff','\ud800\ud800\udfff','\r\n','\r\r\n','\uFEFFabc','x\r😀\ny'];
  let seed=42;const alphabet=['a','\r','\n','한','😀','\ud800','\udfff'];
  for(let i=0;i<1000;i++){
    let s='';for(let j=0;j<30;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;s+=alphabet[seed%alphabet.length];}samples.push(s);
  }
  for(const text of samples){
    const lf=normalize(text),crlf=lf.replace(/\n/g,'\r\n');
    assert.deepEqual(textByteRange(text),{min:new TextEncoder().encode(lf).length,max:new TextEncoder().encode(crlf).length});
  }
});
