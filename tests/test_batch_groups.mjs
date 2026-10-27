import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPolygon } from './helpers/polygon.mjs';
import { readTarget } from '../src/polygon/target.js';
import { syncPackage } from '../src/polygon/sync.js';
import { createMockI18n } from './helpers/i18n.mjs';

const group = (name, dependencies = []) => ({name,dependencies,pointsPolicy:'COMPLETE_GROUP',feedbackPolicy:'COMPLETE'});
const runTask = (_, task) => task();
function fixture(count = 100, {mixed = false} = {}) {
  const mock = createPolygon();
  const plan = {info:{...mock.state.info},statements:[],sources:[],resources:[],aux:[],solutions:[],
    checker:'',validator:'',interactor:'',validatorTests:[],checkerTests:[],tags:[],groups:[group('new')],tests:[]};
  const contents = new Map();
  mock.state.groupsEnabled = true;
  mock.state.groups.set('old',group('old'));
  for (let index = 1; index <= count; index++) {
    const generated = mixed && index % 2 === 0;
    const input = index + '\n';
    const desired = {index,method:generated?'generated':'manual',path:'test/'+index,cmd:'gen '+index,
      group:'new',points:null,sample:false,description:''};
    plan.tests.push(desired);contents.set(desired.path,input);
    mock.state.tests.set(index,{index,manual:!generated,description:'',useInStatements:false,group:'old',
      ...(generated?{scriptLine:desired.cmd+' > '+index}:{input,inputBase64:Buffer.from(input).toString('base64')})});
  }
  mock.state.script = plan.tests.filter(test=>test.method==='generated').map(test=>test.cmd+' > '+test.index).join('\n');
  const archive = {text:async path=>{assert(contents.has(path));return contents.get(path);}};
  const run = async () => syncPackage({api:mock.api,id:42,plan,archive,
    target:await readTarget(mock.api,42,plan),read:runTask,write:runTask});
  return {...mock,plan,contents,run};
}
const requests = (fixture, method) => fixture.calls.filter(call=>call.method===method);
const indices = call => call.args.testIndices.split(',').map(Number);
const withoutGroup = test => {const {group,...rest}=test;return rest;};

for (const count of [1,100,1000]) test(`${count} existing manual group-only changes use one request`,async()=>{
  const f=fixture(count),before=[...f.state.tests.values()].map(withoutGroup);
  const result=await f.run();
  const batches=requests(f,'setTestGroup');
  assert.equal(batches.length,1);
  assert.deepEqual(indices(batches[0]),f.plan.tests.map(test=>test.index));
  assert.equal(batches[0].args.testGroup,'new');
  assert.equal(requests(f,'saveTest').length,0);
  assert.equal(result.testMutations,1);
  assert.deepEqual([...f.state.tests.values()].map(withoutGroup),before);
  assert([...f.state.tests.values()].every(test=>test.group==='new'));
  assert.equal((await f.run()).mutations,0,'Re-upload must skip already assigned groups');
  assert.equal(requests(f,'setTestGroup').length,1);
});

test('manual and generated tests share a batch with stable sorted indices',async()=>{
  const f=fixture(100,{mixed:true});
  await f.run();
  assert.equal(requests(f,'setTestGroup').length,1);
  assert.deepEqual(indices(requests(f,'setTestGroup')[0]),Array.from({length:100},(_,i)=>i+1));
  assert.equal(requests(f,'saveTest').length,0);
  assert.equal(requests(f,'saveScript').length,0);
});

test('different destination groups are never mixed into one batch',async()=>{
  const f=fixture(12,{mixed:true});
  f.plan.groups=['alpha','beta','gamma'].map(name=>group(name));
  f.plan.tests.forEach((test,i)=>test.group=f.plan.groups[i%3].name);
  await f.run();
  const batches=requests(f,'setTestGroup');
  assert.equal(batches.length,3);
  for (const call of batches) assert.deepEqual(indices(call),f.plan.tests.filter(test=>test.group===call.args.testGroup).map(test=>test.index));
  assert.equal(requests(f,'saveTest').length,0);
});

test('other test edits include their group without adding a second request',async()=>{
  const f=fixture(8,{mixed:true});
  f.state.pointsEnabled=true;
  f.plan.tests.forEach(test=>{test.points=10;f.state.tests.get(test.index).points=10;});
  f.plan.tests[0].description='changed';
  f.plan.tests[1].points=0;
  f.contents.set(f.plan.tests[2].path,'different input\n');
  f.plan.tests[3].sample=true;
  f.plan.tests[3].sampleInputPath='sample.in';f.contents.set('sample.in','public input\n');
  f.plan.tests[3].sampleOutputPath='sample.out';f.contents.set('sample.out','public output\n');
  f.plan.tests[4].sample=true;f.state.tests.get(5).useInStatements=true;
  f.plan.tests[4].sampleOutputPath='sample.out';
  // Sample input/output edits must stay on saveTest even if the flag is unchanged.
  const result=await f.run();
  assert.deepEqual(requests(f,'saveTest').map(call=>call.args.testIndex).sort((a,b)=>a-b),[1,2,3,4,5]);
  assert(requests(f,'saveTest').every(call=>call.args.testGroup==='new'));
  assert.equal(requests(f,'setTestGroup').length,1);
  assert.deepEqual(indices(requests(f,'setTestGroup')[0]),[6,7,8]);
  assert.equal(result.testMutations,6,'5 combined writes plus one group-only batch');
  assert.equal(f.state.tests.get(2).points,0);
  assert.equal(f.state.tests.get(3).input,'different input\n');
  assert.equal(f.state.tests.get(4).outputForStatement,'public output\n');
});

test('new manual tests keep their group in the creation request',async()=>{
  const f=fixture(10);
  for(let index=6;index<=10;index++)f.state.tests.delete(index);
  await f.run();
  assert.deepEqual(requests(f,'saveTest').map(call=>call.args.testIndex),[6,7,8,9,10]);
  assert(requests(f,'saveTest').every(call=>call.args.testInput && call.args.testGroup==='new'));
  assert.deepEqual(indices(requests(f,'setTestGroup')[0]),[1,2,3,4,5]);
});

test('generated-only group assignments are deferred until after script creation',async()=>{
  const f=fixture(10);
  f.plan.tests.forEach(test=>test.method='generated');
  f.state.tests.clear();f.state.groups.clear();f.state.script='';
  await f.run();
  assert.equal(requests(f,'saveScript').length,1);
  assert.equal(requests(f,'saveTest').length,0);
  assert.equal(requests(f,'setTestGroup').length,1);
  assert(f.calls.findIndex(call=>call.method==='setTestGroup')>f.calls.findIndex(call=>call.method==='saveScript'));
  assert.equal((await f.run()).mutations,0);
});

test('deferred group-only assignments work across script replacement and deletion',async()=>{
  const f=fixture(8,{mixed:true});
  f.plan.tests=f.plan.tests.filter(test=>![7,8].includes(test.index));
  f.plan.tests.filter(test=>test.method==='generated').forEach(test=>test.cmd+=' updated');
  await f.run();
  assert.equal(requests(f,'clearScript').length,1);
  assert.equal(requests(f,'saveScript').length,1);
  assert.equal(requests(f,'deleteTest').length,1);
  assert.equal(requests(f,'setTestGroup').length,1);
  assert.deepEqual(indices(requests(f,'setTestGroup')[0]),[1,2,3,4,5,6]);
  assert.deepEqual([...f.state.tests.keys()].sort((a,b)=>a-b),[1,2,3,4,5,6]);
});

test('clearing a group uses the established saveTest path',async()=>{
  const f=fixture(6,{mixed:true});
  f.plan.tests.slice(0,5).forEach(test=>test.group='');
  f.plan.groups=[group('old')];f.plan.tests[5].group='old';
  await f.run();
  assert.equal(requests(f,'setTestGroup').length,0);
  assert.equal(requests(f,'saveTest').length,5);
  assert(requests(f,'saveTest').every(call=>call.args.testGroup===''));
  assert.equal((await f.run()).mutations,0);
});

test('no group assignment is sent when groups are disabled',async()=>{
  const f=fixture(6,{mixed:true});f.plan.groups=[];f.plan.tests.forEach(test=>test.group='');
  await f.run();
  assert.equal(requests(f,'setTestGroup').length,0);
  assert.equal(requests(f,'saveTest').length,0);
  assert.equal(f.state.groupsEnabled,false);
});

test('group swaps preserve dependency policies when a group temporarily disappears',async()=>{
  const f=fixture(2,{mixed:true});
  f.state.groups.clear();f.state.groups.set('alpha',group('alpha'));f.state.groups.set('beta',group('beta',['alpha']));
  f.state.tests.get(1).group='alpha';f.state.tests.get(2).group='beta';
  f.plan.groups=[group('beta',['alpha']),group('alpha')];
  f.plan.tests[0].group='beta';f.plan.tests[1].group='alpha';
  await f.run();
  assert.equal(requests(f,'setTestGroup').length,2);
  assert.deepEqual(f.state.groups.get('beta'),group('beta',['alpha']));
  assert.deepEqual(f.state.groups.get('alpha'),group('alpha'));
  assert.equal((await f.run()).mutations,0);
});

for (const after of [false,true]) test(`failed batch ${after?'after':'before'} application is not blindly retried`,async()=>{
  const f=fixture(10,{mixed:true});
  f.state.fail={method:'setTestGroup',after};
  await assert.rejects(f.run,/Injected failure/);
  assert.equal(requests(f,'setTestGroup').length,1);
  assert.equal(requests(f,'saveTest').length,0,'Do not fall back after an uncertain batch failure');
  assert.equal(f.state.commits,0);
  await f.run();
  assert.equal(requests(f,'setTestGroup').length,after?1:2);
  assert([...f.state.tests.values()].every(test=>test.group==='new'));
});

test('retry after partial application sends only the remaining test indices',async()=>{
  const f=fixture(10,{mixed:true}),original=f.api.problem;
  const attempts=[];let failed=false;
  f.api.problem=async(method,id,args,options)=>{
    if(method==='setTestGroup') {
      attempts.push(args.testIndices);
      if(!failed) {
        failed=true;
        await original(method,id,{...args,testIndices:args.testIndices.split(',').slice(0,4).join(',')},options);
        throw Error('Network interrupted after partial assignment');
      }
    }
    return original(method,id,args,options);
  };
  await assert.rejects(f.run,/Network interrupted/);
  assert.deepEqual(attempts,['1,2,3,4,5,6,7,8,9,10']);
  await f.run();
  assert.deepEqual(attempts,['1,2,3,4,5,6,7,8,9,10','5,6,7,8,9,10']);
  assert.equal((await f.run()).mutations,0);
});

test('failed first group batch stops before submitting any later group',async()=>{
  const f=fixture(10,{mixed:true});
  f.plan.groups=[group('alpha'),group('beta')];
  f.plan.tests.forEach((test,i)=>test.group=i<5?'alpha':'beta');
  f.state.fail={method:'setTestGroup'};
  await assert.rejects(f.run,/Injected failure/);
  assert.equal(requests(f,'setTestGroup').length,1);
  assert.equal(requests(f,'saveTestGroup').length,0);
});

test('read-back verification rejects silently ignored batch assignments',async()=>{
  const f=fixture(10),original=f.api.problem;
  f.state.groups.set('new',group('new'));f.state.tests.get(10).group='new';
  f.api.problem=(method,id,args,options)=>{
    if(method==='setTestGroup'){f.calls.push({method,args});return {};}
    return original(method,id,args,options);
  };
  await assert.rejects(f.run,error=>error.message===chrome.i18n.getMessage('syncTestMetadataMismatch'));
  assert.equal(requests(f,'setTestGroup').length,1);
  assert.equal(f.state.commits,0);
});

test('batch progress is translated with the target group and number of tests',async()=>{
  for(const locale of ['en','ko']) {
    chrome.i18n=createMockI18n(locale);
    const f=fixture(3),labels=[];
    await syncPackage({api:f.api,id:42,plan:f.plan,archive:{text:async path=>f.contents.get(path)},
      target:await readTarget(f.api,42,f.plan),read:runTask,
      write:(label,task)=>{labels.push(label);return task();}});
    const expected=chrome.i18n.getMessage('syncAssigningTestGroup',['new','3']);
    assert(expected,'Missing batch localization');assert(labels.includes(expected));
    assert.equal(/[가-힣]/.test(expected),locale==='ko');
  }
});
