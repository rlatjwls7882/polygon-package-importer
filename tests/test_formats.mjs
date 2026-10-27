import { assertNoDataWrites } from './helpers/noop.mjs';
import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMockI18n } from './helpers/i18n.mjs';
import { installDOMParser } from './helpers/xml.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { ZipArchive } from '../src/package/zip.js';
import { loadPolygonPackage } from '../src/package/load.js';
import { executeImport } from '../src/polygon/import.js';

const [directory,casesPath]=process.argv.slice(2);
const cases=JSON.parse(await readFile(casesPath,'utf8'));
async function fixture(name, edit) {
  const tree=structuredClone(cases[name]);
  edit?.(tree);
  installDOMParser(tree);
  const data=await readFile(join(directory,name+'.zip'));
  const file={size:data.length,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.length)};
  return {file,tree};
}
async function upload(mock, name, mode='replace') {
  const {file}=await fixture(name);
  return executeImport({job:{file,mode,problemId:mode==='replace'?'42':null,commit:true},api:mock.api});
}
async function unchangedUpload(mock,name) {
  const start=mock.calls.length;
  const result=await upload(mock,name);
  assertNoDataWrites(result,mock.calls.slice(start));
  return result;
}
const child=(node,tag)=>node.children.find(node=>node.tag===tag);
const judging=root=>child(root,'judging');
const testset=root=>child(judging(root),'testset');
const groups=root=>child(testset(root),'groups').children;
const testNodes=root=>child(testset(root),'tests').children;
const interactor=root=>child(child(root,'assets'),'interactor');
const element=(tag,attributes={},children=[],text='')=>({tag,attributes,children,text});

for (const [name,interactive,runTwice,second] of [
  ['batch',false,false,false], ['two-step',false,true,false], ['interactive',true,false,false],
  ['two-step-interactive-first',true,true,false], ['two-step-interactive-both',true,true,true]
]) {
  const mock=createPolygon();
  const result=await upload(mock,name,'create');
  assert.equal(result.committed,true);
  assert.equal(mock.state.info.interactive,interactive,name);
  assert.equal(mock.state.info.runTwice,runTwice,name);
  assert.equal(mock.state.info.interactiveSecondRun,second,name);
  if (interactive) assert.equal(mock.state.interactor,'interactor.cpp');
  await unchangedUpload(mock,name);
  if (name.startsWith('two-step-interactive')) {
    assert.equal(mock.state.info.useInteractionLogInExampleTests,true);
    assert.equal(mock.state.tests.get(1).input,'1\n','Do not replace judge input with a statement sample');
    assert.equal(mock.state.tests.get(1).inputForStatement,'public input\n');
    assert.equal(mock.state.tests.get(1).outputForStatement,'public output\n');
    assert.equal(mock.state.tests.get(1).interactionLogForStatement,'? 1\n> 2\n! 2\n');
    assert.equal(mock.state.tests.get(2).manual,false);
    assert.equal(mock.state.tests.get(2).inputForStatement,'second input\n');
    assert.equal(mock.state.tests.get(2).interactionLogForStatement,'? 2\n> 3\n! 3\n');
  }
  await upload(mock,'batch');
  assert.equal(mock.state.info.interactive,false);
  assert.equal(mock.state.info.runTwice,false);
  assert.equal(mock.state.info.interactiveSecondRun,false);
  assert.equal(mock.state.info.useInteractionLogInExampleTests,false);
  await upload(mock,name);
  assert.equal(mock.state.info.interactive,interactive);
  assert.equal(mock.state.info.runTwice,runTwice);
  assert.equal(mock.state.info.interactiveSecondRun,second);
  console.log('PASS: format create / no-op / switch to batch / restore:',name);
}

for (const name of ['subtasks-independent','subtasks-dependent','subtasks-reversed',
    'subtasks-group-points','subtasks-each-test','subtasks-diamond','subtasks-ungrouped']) {
  const mock=createPolygon();
  const {file}=await fixture(name);
  const plan=await loadPolygonPackage(await ZipArchive.fromFile(file));
  await upload(mock,name,'create');
  for (const wanted of plan.groups) assert.deepEqual(mock.state.groups.get(wanted.name),wanted);
  for (const test of plan.tests) {
    assert.equal(mock.state.tests.get(test.index).group||'',test.group);
    assert.equal(mock.state.tests.get(test.index).points,test.points);
  }
  await unchangedUpload(mock,name);
  await upload(mock,'batch');
  assert.equal(mock.state.groupsEnabled,false);
  assert.equal(mock.state.pointsEnabled,false);
  await upload(mock,name);
  for (const wanted of plan.groups) assert.deepEqual(mock.state.groups.get(wanted.name),wanted);
  console.log('PASS: subtask points / policies / dependencies / no-op / batch replacement:',name);
}

const reversal=createPolygon();
await upload(reversal,'subtasks-dependent','create');
await upload(reversal,'subtasks-reversed');
assert.deepEqual(reversal.state.groups.get('small').dependencies,['large']);
assert.deepEqual(reversal.state.groups.get('large').dependencies,[]);
await upload(reversal,'subtasks-independent');
assert([...reversal.state.groups.values()].every(group=>!group.dependencies.length));
console.log('PASS: dependency reversal and removal do not create transient cycles');

const dormant=createPolygon();
await upload(dormant,'subtasks-dependent','create');
// A user can disable groups in Polygon without removing stored group metadata.
dormant.state.groupsEnabled=false;
await upload(dormant,'subtasks-reversed');
assert.deepEqual(dormant.state.groups.get('small').dependencies,['large']);
assert.deepEqual(dormant.state.groups.get('large').dependencies,[]);
await unchangedUpload(dormant,'subtasks-reversed');
console.log('PASS: re-enabling hidden groups does not retain old dependency edges');
const dormantRebuild=createPolygon();
await upload(dormantRebuild,'subtasks-diamond','create');
dormantRebuild.state.script='<#-- @group large -->\ngen 99 > 2';
dormantRebuild.state.groupsEnabled=false;
await upload(dormantRebuild,'subtasks-diamond');
assert.deepEqual(dormantRebuild.state.groups.get('all').dependencies,['large','right']);
await unchangedUpload(dormantRebuild,'subtasks-diamond');
console.log('PASS: rebuilding generated tests also clears previously hidden dependency edges');



const rebuild=createPolygon();
await upload(rebuild,'subtasks-dependent','create');
rebuild.state.script='<#-- @group large -->\ngen 99 > 2';
await upload(rebuild,'subtasks-dependent');
assert.equal(rebuild.state.script,'gen 99 > 2');
assert.deepEqual(rebuild.state.groups.get('large').dependencies,['small']);
await upload(rebuild,'subtasks-ungrouped');
assert.equal(rebuild.state.tests.get(3).group||'','');
// Previously grouped tests must also be explicitly unassigned in-place.
rebuild.state.tests.get(3).group='large';
rebuild.state.tests.get(3).points=999;
await upload(rebuild,'subtasks-ungrouped');
assert.equal(rebuild.state.tests.get(3).group,'');
assert.equal(rebuild.state.tests.get(3).points,0);
console.log('PASS: regenerated scripts preserve group policies and do not leak groups or old scores');

for (const [method,name,after,when] of [
  ['updateInfo','two-step-interactive-both',true,args=>'interactiveSecondRun' in args],
  ['setInteractor','two-step-interactive-both',true],
  ['saveTest','subtasks-dependent',true,args=>'testPoints' in args],
  ['saveTestGroup','subtasks-dependent',true,args=>!!args.dependencies],
  ['saveScript','subtasks-diamond',true]
]) {
  const mock=createPolygon();mock.state.fail={method,after,when};
  await assert.rejects(()=>upload(mock,name,'create'),/Injected failure/);
  assert.equal(mock.state.commits,0);
  assert.equal(mock.state.creates,1);
  await upload(mock,name);
  assert.equal(mock.state.creates,1,'retry must not create a second problem');
  assert.equal(mock.state.commits,1);
  await unchangedUpload(mock,name);
  console.log('PASS: retry resumes after an applied but failed response:',method,name);
}

for (const [field,name] of [['ignoreRunTwice','two-step'],['ignorePoints','subtasks-dependent']]) {
  const mock=createPolygon();mock.state[field]=true;
  await assert.rejects(()=>upload(mock,name,'create'));
  assert.equal(mock.state.commits,0,'verification must block commit after a silently ignored setting');
  mock.state[field]=false;
  await upload(mock,name);
  assert.equal(mock.state.commits,1);
}
console.log('PASS: read-back verification blocks success and commit for unapplied judging flags or scores');

// Existing tests keep their input/points, so restoring their groups uses only bulk assignment.
for (const after of [false,true]) {
  const mock=createPolygon();
  await upload(mock,'subtasks-independent','create');
  for (const test of mock.state.tests.values()) test.group='old';
  mock.state.groups.clear();
  mock.state.groups.set('old',{name:'old',pointsPolicy:'COMPLETE_GROUP',feedbackPolicy:'COMPLETE',dependencies:[]});
  mock.state.entry.modified=true;
  mock.state.fail={method:'setTestGroup',after};
  await assert.rejects(()=>upload(mock,'subtasks-independent'),error=>{
    assert.equal(error.partial,true);assert.equal(error.problemId,42);
    return /Injected failure/.test(error.message);
  });
  assert.equal(mock.state.commits,1,'Failed bulk assignment must not be committed');
  const calls=mock.calls.length;
  await upload(mock,'subtasks-independent');
  assert.equal(mock.state.creates,1);
  assert.equal(mock.state.commits,2);
  assert.equal(mock.calls.slice(calls).filter(call=>call.method==='setTestGroup').length,after?1:2);
  await unchangedUpload(mock,'subtasks-independent');
}
console.log('PASS: batch assignment failures block commit; retry re-reads groups without creating another problem');

const ignoredGroups=createPolygon();
await upload(ignoredGroups,'subtasks-independent','create');
ignoredGroups.state.tests.get(1).group='large';
const originalGroupProblem=ignoredGroups.api.problem;
ignoredGroups.api.problem=(method,id,args,options)=>method==='setTestGroup'?Promise.resolve({}):originalGroupProblem(method,id,args,options);
await assert.rejects(()=>upload(ignoredGroups,'subtasks-independent'),error=>error.message===chrome.i18n.getMessage('syncTestMetadataMismatch'));
assert.equal(ignoredGroups.state.commits,1,'Read-back mismatch must prevent commit after a supposedly successful batch');
console.log('PASS: ignored batch assignments cannot produce a successful import or commit');

const invalid=[
  ['batch',root=>{const solutions=child(child(root,'assets'),'solutions');solutions.children.push(structuredClone(solutions.children[0]));}],
  ['batch',root=>{judging(root).attributes['run-count']='3';}],
  ['batch',root=>{judging(root).attributes['run-count']='false';}],
  ['interactive',root=>{interactor(root).children=[];}],
  ['interactive',root=>{interactor(root).children.push(element('runs',{},[element('run',{},[],'2')]));}],
  ['two-step-interactive-both',root=>{child(interactor(root),'runs').children.push(element('run',{},[],'1'));}],
  ['subtasks-dependent',root=>{groups(root)[1].children.push(element('dependencies',{},[element('dependency',{group:'large'})]));}],
  ['subtasks-dependent',root=>{groups(root)[0].children[0].children[0].attributes.group='absent';}],
  ['subtasks-independent',root=>{groups(root)[1].attributes.name='small';}],
  ['subtasks-independent',root=>{groups(root)[0].attributes['points-policy']='typo';}],
  ['subtasks-independent',root=>{groups(root)[0].attributes['feedback-policy']='typo';}],
  ['subtasks-independent',root=>{groups(root).push(element('group',{name:'empty'}));}],
  ['subtasks-independent',root=>{testNodes(root)[0].attributes.points='1.001';}],
  ['subtasks-independent',root=>{testNodes(root)[0].attributes.points='-1';}],
  ['subtasks-independent',root=>{groups(root)[0].attributes.points='99';}],
  ['subtasks-group-points',root=>{groups(root)[0].attributes['points-policy']='each-test';}],
  ['subtasks-independent',root=>{testNodes(root)[0].attributes.group='unknown';}]
];
for (const locale of ['ko','en']) {
  chrome.i18n=createMockI18n(locale);
  for (const [name,edit] of invalid) {
    const {file}=await fixture(name,edit);
    const mock=createPolygon();
    await assert.rejects(()=>executeImport({job:{file,mode:'create'},api:mock.api}),error=>{
      assert(!(error instanceof TypeError));
      assert.equal(/[가-힣]/.test(error.message),locale==='ko');
      return true;
    });
    assert.equal(mock.calls.length,0,'Malformed package must be rejected before any remote request');
  }
}
console.log('PASS: invalid run modes, missing interactors, group cycles/duplicates/policies and ambiguous points fail before remote writes in both locales');
