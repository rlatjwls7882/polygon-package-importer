import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { syncPackage } from '../src/polygon/sync.js';
import { configureScoring, syncGroups } from '../src/polygon/groups.js';
import { syncStatements } from '../src/polygon/statements.js';

const plan = {
  info:{timeLimit:1000,memoryLimit:256,inputFile:'stdin',outputFile:'stdout',interactive:true},
  statements:[], sources:[{name:'interactor.cpp',path:'files/interactor.cpp'}],
  resources:[], aux:[], solutions:[], checker:'std::wcmp', validator:'', interactor:'interactor.cpp',
  tests:[], groups:[], validatorTests:[], checkerTests:[], tags:[]
};
const calls = [];
const info = {...plan.info};
const api = {problem:async (method,id,args) => {
  calls.push({method,id,args});
  if (method==='info') return info;
  if (method==='interactor') return 'interactor.cpp';
  if (method==='updateInfo') Object.assign(info,args);
  return {};
}};
const run = (_, task) => task();
await syncPackage({api,id:42,plan,archive:{text:async () => 'int main(){}'},read:run,write:run});
const methods = calls.map(call => call.method);
assert(methods.indexOf('saveFile') < methods.indexOf('setInteractor'));
assert.equal(calls.find(call => call.method === 'setInteractor').args.interactor,'interactor.cpp');
assert.equal(calls.find(call => call.method === 'updateInfo').args.interactive,'true');
console.log('PASS: judge settings are synchronized after uploading their source files');

const groups = [
  {name:'large',dependencies:['small'],pointsPolicy:'COMPLETE_GROUP',feedbackPolicy:'COMPLETE'},
  {name:'small',dependencies:[],pointsPolicy:'COMPLETE_GROUP',feedbackPolicy:'COMPLETE'}
];
const groupCalls = [], skipped = [];
let existing = groups.map(group=>({...group,pointsPolicy:'EACH_TEST',dependencies:[]}));
const context = {
  api:{problem:async (method,id,args) => {
    if (method === 'viewTestGroup') return existing;
    groupCalls.push({method,id,args});
    if (method==='saveTestGroup') {
      const group=existing.find(group=>group.name===args.group);
      Object.assign(group,{pointsPolicy:args.pointsPolicy,feedbackPolicy:args.feedbackPolicy,dependencies:args.dependencies?args.dependencies.split(','):[]});
    }
    return {};
  }}, id:42,
  plan:{groups,tests:[{group:'small',points:30},{group:'large',points:70}]},
  target:null, read:run, apply:run, unchanged:label => skipped.push(label)
};
await configureScoring(context);
await syncGroups(context);
assert.deepEqual(groupCalls.map(call => call.method), ['enableGroups','enablePoints','saveTestGroup','saveTestGroup']);
assert.equal(groupCalls[2].args.dependencies,'');
assert.equal(groupCalls[3].args.dependencies,'small');
assert(groupCalls.filter(call => call.method !== 'enablePoints').every(call => call.args.testset === 'tests'));
existing = structuredClone(groups);
context.target = {tests:[{group:'small',points:30},{group:'large',points:70}]};
groupCalls.length = 0;
await configureScoring(context);
await syncGroups(context);
assert.equal(groupCalls.length,0);
assert.equal(skipped.length,2);
console.log('PASS: scoring and explicit group dependencies survive synchronization; unchanged groups are skipped');

context.plan = {groups:[],tests:[{group:'',points:null}]};
await configureScoring(context);
assert.deepEqual(groupCalls.map(call => [call.method, call.args.enable]), [['enableGroups','false'],['enablePoints','false']]);
console.log('PASS: replacing scored groups with an ordinary testset disables group and point modes');

for (const fail of [false,'enable','statement']) {
  let interactive=false, saved=null;
  const calls=[];
  const statement={lang:'english',name:'Dormant interaction',interaction:'Preserve this hidden native section.\n'};
  const api={problem:async(method,id,args)=>{
    calls.push({method,args});
    if(method==='updateInfo'){
      interactive=args.interactive==='true';
      if(interactive&&fail==='enable')throw Error('Enable reply lost');
    }
    if(method==='saveStatement'){
      assert(interactive,'Polygon rejects the interaction section while disabled');
      if(fail==='statement')throw Error('Statement write failed');
      saved=args;
    }
  }};
  const run=()=>syncStatements({api,id:42,plan:{info:{interactive:false},statements:[statement]},
    target:{statements:{english:{name:statement.name}}},apply:(_,fn)=>fn(),unchanged:()=>{}});
  if(fail)await assert.rejects(run,fail==='enable'?/Enable reply lost/:/Statement write failed/);
  else{await run();assert.equal(saved.interaction,statement.interaction);}
  assert.equal(interactive,false,'Do not leave interactive judging enabled after a statement failure');
  assert.deepEqual(calls.map(c=>c.method),fail==='enable'?['updateInfo','updateInfo']:['updateInfo','saveStatement','updateInfo']);
}
console.log('PASS: dormant native interaction sections survive batch imports and failure restores judging');
