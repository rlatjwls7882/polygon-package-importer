import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import {readAssets, resolveDuplicateSolutionNames} from '../src/package/assets.js';
import {syncFiles} from '../src/polygon/files.js';

const paths=['solutions/MCS.cpp',
  ...Array.from({length:9},(_,i)=>'solutions/verification/'+(438+i)+'/Main.cpp')];
const tags=['MA',...Array(7).fill('WA'),'TL','RE'];
const solution=(path,tag='WA')=>({path,name:path.split('/').pop(),tag,sourceType:'cpp.g++20',extraTags:[]});
const files=paths.map((path,i)=>solution(path,tags[i]));
const rename=items=>{const cloned=structuredClone(items);resolveDuplicateSolutionNames(cloned);return cloned;};
const actual=rename(files);
assert.deepEqual(actual.map(s=>s.name),
  ['MCS.cpp',...Array.from({length:9},(_,i)=>'Main-'+(438+i)+'.cpp')]);
assert.equal(new Set(actual.map(s=>s.name)).size,10);
assert.deepEqual(actual.map(s=>s.path), paths);
assert.deepEqual(actual.map(s=>s.tag),tags);
assert.deepEqual(new Map(rename(files.slice().reverse()).map(s=>[s.path,s.name])),
  new Map(actual.map(s=>[s.path,s.name])), 'ZIP order must not rename solutions');
assert.equal(rename([solution('solutions/one.cpp')])[0].name,'one.cpp');
assert.equal(rename([solution('solutions/verification/438/Main.cpp'),
  solution('solutions/verification/439/Main.cpp'),
  solution('solutions/other/Main-438.cpp')])[0].name,'Main-verification-438.cpp');
assert.throws(()=>rename([solution('solutions/a/Main.cpp'),solution('solutions/a/Main.cpp')]));
assert.throws(()=>rename([solution('solutions/a/Main.java'),solution('solutions/b/Main.java')]));
console.log('PASS: SOJ C++ verification solutions keep all ten roles and stable unique names');

// Exercise the normal XML parser and Polygon solution-save namespace, not just the helper.
function element(tag, attrs={}, children=[]) {
  return {localName:tag,children,
    getAttribute:key=>Object.hasOwn(attrs,key)?attrs[key]:null,
    hasAttribute:key=>Object.hasOwn(attrs,key)};
}
const root=element('problem',{},[
  element('assets',{},[element('solutions',{},paths.map((path,i)=>
    element('solution',{tag:({
      MA:'main', WA:'wrong-answer', TL:'time-limit-exceeded', RE:'runtime-error'
    })[tags[i]]},[element('source',{path,type:'cpp.g++20'})])))])
]);
const plan={sources:[],resources:[],aux:[],solutions:[],unsupported:[]};
const archive={
  has:path=>paths.includes(path),
  async text(path){return '// '+path+'\nint main(){}\n';}
};
await readAssets(root,archive,plan);
assert.deepEqual(plan.solutions.map(s=>s.name),actual.map(s=>s.name));
assert.deepEqual(plan.unsupported,[]);
const saved=new Map(),calls=[];
const api={async problem(method,id,args) {
  if (method==='saveSolution') {
    calls.push([method,args.name,args.tag]);
    saved.set(args.name,{name:args.name,tag:args.tag,sourceType:args.sourceType,
      file:args.file,length:new TextEncoder().encode(args.file).length});
    return {};
  }
  if (method==='viewSolution') return saved.get(args.name)?.file;
  throw Error('unexpected Polygon API call '+method);
}};
async function sync() {
  return syncFiles({api,id:586963,archive,plan,target:{
    files:{sourceFiles:[],resourceFiles:[],auxFiles:[]},
    solutions:[...saved.values()]},read:(_label,fn)=>fn(),
    apply:(_label,fn)=>fn(),unchanged:()=>{}});
}
await sync();
assert.equal(saved.size,10);
assert.equal(calls.filter(call=>call[0]==='saveSolution').length,10);
assert.deepEqual([...saved.keys()],actual.map(s=>s.name));
for (const item of actual) {
  const stored=saved.get(item.name);
  assert.equal(stored.file,await archive.text(item.path));
  assert.equal(stored.tag,item.tag);
  assert.equal(stored.sourceType,'cpp.g++20');
}
await sync();
assert.equal(calls.length,10,'same ZIP on an existing problem must not re-upload solutions');
console.log('PASS: ten unique solution names upload without overwrites and repeat as a no-op');
