// Synthetic costs, not native Chrome heap, physical I/O, or Polygon latency.
// node tests/benchmark_preflight.mjs /path/to/baseline-checkout
import './helpers/i18n.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createPolygon } from './helpers/polygon.mjs';
const roots=[['baseline',pathToFileURL(resolve(process.argv[2])+'/')],['updated',new URL('../',import.meta.url)]];
const result={kind:'synthetic operation/allocation counts',node:process.version};
for(const [label,root] of roots){
  const {readTarget}=await import(new URL('src/polygon/target.js',root));
  const {syncFiles}=await import(new URL('src/polygon/files.js',root));
  const {sameText}=await import(new URL('src/polygon/compare.js',root));
  const scenarios=[];
  for(const reason of ['stresses','extraValidators']){
    const mock=createPolygon(),original=mock.api.problem;let requests=1,bodyReads=0;
    mock.api.problem=async(method,...args)=>{
      requests++;if(['tests','statements','validatorTests','checkerTests'].includes(method))bodyReads++;
      if(method===reason)return reason==='stresses'?[{id:1}]:['extra.cpp'];
      return original(method,...args);
    };
    await assert.rejects(()=>readTarget(mock.api,42,{tests:[{index:1,method:'manual'}]}));
    scenarios.push({reason,requests,bodyReads});
  }
  const text='// source line\r\n'.repeat(65536),lf=text.replace(/\r\n/g,'\n');
  const oldEncode=TextEncoder.prototype.encode,oldSplit=String.prototype.split,oldReplace=String.prototype.replace;
  let encodedBytes=0,lineArrayEntries=0,normalizations=0;
  TextEncoder.prototype.encode=function(value){const bytes=oldEncode.call(this,value);encodedBytes+=bytes.length;return bytes;};
  String.prototype.split=function(separator,...args){const values=oldSplit.call(this,separator,...args);if(separator==='\n')lineArrayEntries+=values.length;return values;};
  String.prototype.replace=function(...args){if(args[0] instanceof RegExp && args[0].source==='\\r\\n?')normalizations++;return oldReplace.apply(this,args);};
  try {
    await syncFiles({api:{problem:async()=>lf},id:42,
      plan:{sources:[{name:'a.cpp',path:'a.cpp'}],resources:[],aux:[],solutions:[]},
      archive:{text:async()=>text},target:{files:{sourceFiles:[{name:'a.cpp',length:lf.length}]}},
      read:(_,fn)=>fn(),apply:()=>assert.fail('Unexpected save'),unchanged:()=>{}});
    assert(sameText(text,lf));
  } finally {TextEncoder.prototype.encode=oldEncode;String.prototype.split=oldSplit;String.prototype.replace=oldReplace;}
  result[label]={scenarios,sourceCharacters:text.length,encodedBytesForLengthCheck:encodedBytes,lineArrayEntries,normalizationCalls:normalizations};
}
console.log(JSON.stringify(result,null,2));
