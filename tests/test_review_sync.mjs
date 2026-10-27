import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPolygon } from './helpers/polygon.mjs';
import { readTarget } from '../src/polygon/target.js';
import { syncPackage } from '../src/polygon/sync.js';

const makePlan = () => ({info:{timeLimit:1000,memoryLimit:256,inputFile:'stdin',outputFile:'stdout',
  interactive:false,runTwice:false},statements:[],sources:[],resources:[],aux:[],solutions:[],
  checker:'',validator:'',interactor:'',tests:[],groups:[],validatorTests:[],checkerTests:[],tags:[]});
const run = (_, fn) => fn();
async function sync(mock, plan, contents) {
  const target=await readTarget(mock.api,42,plan);
  return syncPackage({api:mock.api,id:42,plan,target,archive:{text:async path=>contents[path]},read:run,write:run});
}

test('EOL-equivalent sources, resources and solutions are not re-uploaded', async () => {
  const mock=createPolygon(),plan=makePlan();
  for (const [type,key] of [['source','sources'],['resource','resources'],['aux','aux']]) {
    const name=type+'.txt';plan[key]=[{name,path:name}];
    mock.state.files[type].set(name,'one\r\ntwo\r\n');
  }
  plan.solutions=[{name:'sol.cpp',path:'sol.cpp',tag:'MA'}];
  mock.state.solutions.set('sol.cpp',{name:'sol.cpp',file:'one\r\ntwo\r\n',tag:'MA'});
  const files=Object.fromEntries(['source.txt','resource.txt','aux.txt','sol.cpp'].map(name=>[name,'one\ntwo\n']));
  const result=await sync(mock,plan,files);
  assert.equal(result.mutations,0,'LF and CRLF are already treated as equivalent by sameText');
  assert.equal(mock.calls.filter(call=>['saveFile','saveSolution'].includes(call.method)).length,0);
});

test('generated-only imports do not download old manual input bodies', async () => {
  const mock=createPolygon(),plan=makePlan();
  plan.tests=[{index:1,method:'generated',cmd:'gen 1',points:null,group:'',sample:false}];
  await readTarget(mock.api,42,plan);
  assert.equal(mock.calls.find(call=>call.method==='tests').args.noInputs,'true');
});

test('a tag-only edit preserves source without sending the source again', async () => {
  const mock=createPolygon(),plan=makePlan();
  plan.solutions=[{name:'same.cpp',path:'same.cpp',tag:'WA'}];
  mock.state.solutions.set('same.cpp',{name:'same.cpp',file:'original',tag:'OK'});
  await sync(mock,plan,{'same.cpp':'original'});
  const writes=mock.calls.filter(call=>call.method==='saveSolution');
  assert.equal(writes.length,1);
  assert.equal(Object.hasOwn(writes[0].args,'file'),false);
  assert.equal(mock.state.solutions.get('same.cpp').file,'original');
});

test('invalid stress response must not allow overwriting a problem', async () => {
  const mock=createPolygon(),original=mock.api.problem;
  mock.api.problem=(method,...args)=>method==='stresses'?Promise.resolve(null):original(method,...args);
  await assert.rejects(()=>readTarget(mock.api,42,makePlan()));
});
