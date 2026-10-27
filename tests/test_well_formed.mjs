import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, n } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { attachBuild } from './helpers/build.mjs';
import { installNativeTestParser } from './helpers/native-xml.mjs';
import { executeImport } from '../src/polygon/import.js';
import { infoChanges } from '../src/polygon/compare.js';
import { infoSnapshot } from '../src/polygon/snapshot.js';

function properties(root, values) {
  let container = root.children.find(node => node.tag === 'properties');
  if (!container) {container = n('properties');root.children.push(container);}
  container.children = container.children.filter(node => node.attributes.name !== 'tests-wellformed');
  for (const value of values) container.children.push(n('property', {name:'tests-wellformed', value}));
}
function sample(value, options = {}) {
  return fixture({...options, mutate({root}) {properties(root, value === undefined ? [] : [value]);}});
}
function buildEnvironment(value = 'false', options = {}) {
  const f = sample(value, options), mock = createPolygon(), build = attachBuild(mock);
  let checkpoint = null, id = null;
  return {f,mock,build, get checkpoint(){return checkpoint;},
    async run() {
      installNativeTestParser();
      return executeImport({job:{file:f.file,mode:id?'replace':'create',problemId:id,
          commit:true,verify:true,verification:checkpoint}, api:mock.api,
        onCreated:async value=>{id=String(value);},
        onCheckpoint:async value=>{checkpoint=structuredClone(value);},
        verificationOptions:{maxPolls:1,pollMs:0,sleep:async()=>{}}});
    }};
}

for (const value of [undefined,'false','true']) test('import policy forces wellFormed=true for source '+String(value),async()=>{
  const f = sample(value);
  assert.equal((await f.parse()).info.wellFormed,true);
  const mock = createPolygon();mock.state.info.wellFormed=false;
  const result = await f.upload(mock);
  assert.equal(result.committed,true);
  const updates=mock.calls.filter(call=>call.method==='updateInfo');
  assert(updates.some(call=>call.args.wellFormed==='true'));
  assert(!updates.some(call=>call.args.wellFormed==='false'));
  assert.equal(mock.state.info.wellFormed,true);
});

for (const [name,options] of [
  ['batch',{groups:false}],['interactive',{interactive:true,groups:false}],
  ['two-step',{twice:true,groups:false}],['two-step interactive',{twice:true,interactive:true}],
  ['scored subtask',{percent:true}]
]) test('overwrite repairs a false wellFormed flag for '+name,async()=>{
  const mock=createPolygon(),f=sample('false',options);
  await f.upload(mock);mock.state.info.wellFormed=false;
  const begin=mock.calls.length;await f.upload(mock,'replace');
  const updates=mock.calls.slice(begin).filter(call=>call.method==='updateInfo');
  assert.equal(updates.length,1);assert.deepEqual(updates[0].args,{wellFormed:'true'});
  assert.equal(mock.state.info.wellFormed,true);
  const next=mock.calls.length;await f.upload(mock,'replace');
  assert(!mock.calls.slice(next).some(call=>call.method==='updateInfo'),'An already true flag needs no redundant update');
});

test('wellFormed comparison treats missing as requiring true and does not modify unrelated flags',()=>{
  for (const value of [undefined,false,'false'])
    assert.deepEqual(infoChanges({wellFormed:value,skipDuplicatedTestsValidation:true},{wellFormed:true}),{wellFormed:'true'});
  for (const value of [true,'true']) assert.deepEqual(infoChanges({wellFormed:value},{wellFormed:true}),{});
});

test('invalid wellFormed response fails before applying edits',()=>{
  const info=createPolygon().state.info;
  for (const value of [null,1,'yes',{}]) assert.throws(()=>infoSnapshot({...info,wellFormed:value}));
});

for (const value of [false,undefined]) test('ignored true setting blocks commit: server returns '+String(value),async()=>{
  const mock=createPolygon(),original=mock.api.problem;
  if(value===undefined)delete mock.state.info.wellFormed;else mock.state.info.wellFormed=value;
  mock.api.problem=async(method,id,args,options)=>{
    if(method==='updateInfo'){const {wellFormed,...rest}=args;args=rest;}
    return original(method,id,args,options);
  };
  await assert.rejects(()=>sample('false').upload(mock),error=>error.message===chrome.i18n.getMessage('syncJudgingMismatch'));
  assert.equal(mock.state.commits,0);
});

test('strict build verification expects true even when the original XML says false',async()=>{
  const e=buildEnvironment('false',{interactive:true,twice:true});
  e.build.transformArchive=root=>properties(root,['true']);
  const result=await e.run();
  assert.equal(result.verification.state,'verified');
  assert.equal(e.mock.state.info.wellFormed,true);
  assert.equal(e.build.builds,1);
});

for (const [name,values] of [['false',['false']],['missing',[]],['invalid',['1']],
    ['conflicting',['true','false']],['duplicate true',['true','true']]])
  test('strict build verification rejects '+name+' wellformed property',async()=>{
    const e=buildEnvironment('false');e.build.transformArchive=root=>properties(root,values);
    await assert.rejects(()=>e.run(),error=>error.committed===true &&
      error.message===chrome.i18n.getMessage('verifyDescriptorMismatch',['tests-wellformed']));
    assert.equal(e.mock.state.commits,1,'Build verification follows commit and does not undo it');
    assert.notEqual(e.checkpoint.stage,'verified');
    await assert.rejects(()=>e.run());
    assert.equal(e.build.builds,1,'Retry must check the same build, not create a replacement');
  });
