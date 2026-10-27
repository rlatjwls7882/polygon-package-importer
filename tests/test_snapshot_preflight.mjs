import { syncPackage } from '../src/polygon/sync.js';
import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTarget } from '../src/polygon/target.js';
import { createPolygon } from './helpers/polygon.mjs';
const plan = {tests:[{index:1,method:'manual'}]};

for (const reason of ['stresses','extraValidators']) test('unsupported '+reason+' is rejected before downloading test/source bodies',async()=>{
  const mock=createPolygon(),original=mock.api.problem;
  const calls=[];
  mock.api.problem=async(method,...args)=>{
    calls.push(method);
    if(method===reason)return reason==='stresses'?[{id:1}]:['extra.cpp'];
    return original(method,...args);
  };
  await assert.rejects(()=>readTarget(mock.api,42,plan));
  assert(!calls.some(method=>['tests','statements','validatorTests','checkerTests','files','solutions'].includes(method)),calls.join(','));
});

test('a failed preflight read does not prequeue the rest of the snapshot',async()=>{
  const mock=createPolygon(),calls=[],original=mock.api.problem;
  mock.api.problem=async(method,...args)=>{
    calls.push(method);
    if(method==='files')throw Error('files unavailable');
    return original(method,...args);
  };
  await assert.rejects(()=>readTarget(mock.api,42,plan),/files unavailable/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.at(-1),'files',calls.join(','));
});

for (const [method,value] of [
  ['tests',[{index:1,manual:true},{index:'1',manual:false}]],
  ['tests',[{index:0,manual:true}]],
  ['tests',[{index:1,manual:'maybe'}]],
  ['files',{sourceFiles:[{name:'a.cpp'},{name:'a.cpp'}],resourceFiles:[],auxFiles:[]}],
  ['solutions',[{name:'a.cpp',tag:'MA'},{name:'a.cpp',tag:'WA'}]],
  ['statements',[]],
  ['validatorTests',[{index:1,input:'a',expectedVerdict:'VALID'},{index:1,input:'b',expectedVerdict:'VALID'}]],
  ['checkerTests',[{index:1,input:'a',expectedVerdict:'OK',output:null,answer:'b'}]]
]) test('malformed '+method+' snapshot fails before it can become an overwrite plan',async()=>{
  const mock=createPolygon(),original=mock.api.problem;
  mock.api.problem=(m,...args)=>m===method?Promise.resolve(value):original(m,...args);
  await assert.rejects(()=>readTarget(mock.api,42,plan));
});

for(const [method,value] of [['info',null],['viewTags',{}],['checker',{}]])
  test('invalid '+method+' settings cannot turn a read failure into overwrite mutations',async()=>{
    const mock=createPolygon(),original=mock.api.problem;
    const plan={info:mock.state.info,checker:'std::wcmp',validator:'',interactor:'',
      statements:[],sources:[],resources:[],aux:[],solutions:[],tests:[],groups:[],tags:[],validatorTests:[],checkerTests:[]};
    const target=await readTarget(mock.api,42,plan);
    mock.api.problem=(m,...args)=>m===method?Promise.resolve(value):original(m,...args);
    let writes=0;
    await assert.rejects(()=>syncPackage({api:mock.api,id:42,plan,target,archive:{text:async()=>''},
      read:(_,fn)=>fn(),write:(_,fn)=>{writes++;return fn();}}));
    assert.equal(writes,0,'Malformed settings reached the mutation phase');
  });
