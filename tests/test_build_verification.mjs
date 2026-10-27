import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { attachBuild } from './helpers/build.mjs';
import { installNativeTestParser } from './helpers/native-xml.mjs';
import { executeImport } from '../src/polygon/import.js';

function environment(options={}) {
  const f=fixture(options),mock=createPolygon(),build=attachBuild(mock),progress=[];
  let saved=null,problemId=null;
  return {f,mock,build,progress,get checkpoint(){return saved;},
    run(overrides={}) {
      installNativeTestParser();
      return executeImport({api:mock.api,
        job:{file:f.file,mode:problemId?'replace':'create',problemId,commit:true,verify:true,verification:saved,...overrides},
        onCreated:async id=>{problemId=String(id);},onCheckpoint:async checkpoint=>{saved=structuredClone(checkpoint);},
        onProgress:async value=>progress.push(value),
        verificationOptions:{maxPolls:2,pollMs:0,sleep:async()=>{}}
      });
    }};
}

test('strong mode verifies the committed revision, original metadata, tags and every run',async()=>{
  const e=environment({interactive:true,twice:true,percent:true,grader:true,extraTags:true,selfTests:true,padded:true});
  const result=await e.run();
  assert.equal(result.verification.state,'verified');assert.equal(result.verification.runs,4);
  assert.equal(result.verification.revision,e.mock.state.entry.revision);
  assert.equal(e.mock.state.creates,1);assert.equal(e.build.builds,1);
  assert(e.mock.calls.findIndex(c=>c.method==='commitChanges')<e.mock.calls.findIndex(c=>c.method==='buildPackage'));
  assert(e.progress.some(value=>value.stage==='verifying'&&value.committed===true));
  assert.equal(e.progress.at(-1).stage,'verified');
});

test('upload-only mode never claims an execution check or starts a build',async()=>{
  const e=environment({interactive:true});const result=await e.run({verify:false});
  assert.equal(result.verification.state,'not-run');assert.equal(e.build.builds,0);
  assert.equal(e.progress.at(-1).stage,'uploaded');
});

test('verification without committing is rejected before any API request',async()=>{
  const e=environment();await assert.rejects(()=>e.run({commit:false}));assert.equal(e.mock.calls.length,0);
});

test('F10: a server compile failure never produces verified success and reports that upload was committed',async()=>{
  const e=environment({interactive:true,mutate({contents}){contents['files/interactor.cpp']='invalid C++';}});
  e.build.afterBuild=record=>{record.pkg.state='FAILED';record.pkg.comment='Interactor compilation error';};
  await assert.rejects(()=>e.run(),error=>error.committed===true&&error.partial===true);
  assert.equal(e.mock.state.commits,1);assert.equal(e.checkpoint.stage,'polling');
  assert(!e.progress.some(value=>value.stage==='verified'));
});

for (const status of ['PENDING','RUNNING','ABORTED']) test('unfinished/aborted invocation does not pass: '+status,async()=>{
  const e=environment();e.build.afterBuild=record=>{record.detail.invocation.status=status;};
  await assert.rejects(()=>e.run());assert.equal(e.build.builds,1);
});

test('missing solution-test pairs remain unverified; retry checks the same package',async()=>{
  const e=environment({extraTags:true});let missing;
  e.build.afterBuild=record=>{missing=record.detail.runs.pop();};
  await assert.rejects(()=>e.run());
  e.build.records[0].detail.runs.push(missing);
  const result=await e.run();assert.equal(result.verification.state,'verified');
  assert.equal(e.build.builds,1);assert.equal(e.mock.state.commits,1);assert.equal(e.mock.state.creates,1);
});

test('a lost build response is recovered without issuing a duplicate build',async()=>{
  const e=environment();e.build.loseBuildResponse=true;
  await assert.rejects(()=>e.run(),/Build response lost/);
  assert.equal(e.checkpoint.stage,'launching');assert.equal(e.checkpoint.packageId,null);
  assert.equal((await e.run()).verification.state,'verified');assert.equal(e.build.builds,1);
});

test('build APIs without a result object are correlated to a single new package',async()=>{
  const e=environment();e.build.noBuildResult=true;
  assert.equal((await e.run()).verification.state,'verified');assert.equal(e.build.builds,1);
});

test('ambiguous build candidates are not guessed',async()=>{
  const e=environment();e.build.loseBuildResponse=true;
  await assert.rejects(()=>e.run());
  const duplicate=structuredClone(e.build.records[0].pkg);duplicate.id++;
  e.build.records.push({pkg:duplicate,detail:e.build.records[0].detail});
  await assert.rejects(()=>e.run());assert.equal(e.build.builds,1);
});

test('a revision changed during verification cannot reuse an old successful build',async()=>{
  const e=environment();e.build.afterBuild=record=>{record.pkg.state='RUNNING';};
  await assert.rejects(()=>e.run());
  e.mock.state.entry.revision++;e.mock.state.entry.workingCopyRevision++;
  await assert.rejects(()=>e.run());assert.equal(e.build.builds,1);
});

test('new working-copy changes block a checkpoint resume without overwriting those edits',async()=>{
  const e=environment();e.build.afterBuild=record=>{record.pkg.state='RUNNING';};
  await assert.rejects(()=>e.run());e.mock.state.entry.modified=true;
  const start=e.mock.calls.length;await assert.rejects(()=>e.run());
  assert(e.mock.calls.slice(start).every(c=>c.method==='problems.list'));
});

for (const [title,mutate] of [
  ['package verification comment without a violating run',record=>{record.pkg.comment='WA solution unexpectedly passed all tests';}],
  ['invocation violation flag',record=>{record.detail.invocation.violateTag=true;}],
  ['run violation flag',record=>{record.detail.runs[0].violateTag=true;}],
  ['compilation error verdict',record=>{record.detail.runs[0].verdict='CE';}],
  ['unknown run verdict',record=>{record.detail.runs[0].verdict='UNKNOWN';}],
  ['duplicate run pair',record=>{record.detail.runs[1]=record.detail.runs[0];}],
  ['different testset',record=>{record.detail.invocation.testset='other';}],
  ['wrong package id',record=>{record.detail.invocation.packageId++;}],
  ['wrong solution set',record=>{record.detail.invocation.solutions=['unknown.cpp'];}],
  ['extra-tag mismatch',record=>{record.detail.solutionTags[0].groupTags={A:'WA'};}]
]) test('strict execution checks reject '+title,async()=>{
  const e=environment();e.build.afterBuild=mutate;await assert.rejects(()=>e.run());
  assert(!e.progress.some(value=>value.stage==='verified'));
});

for (const [title,transform] of [
  ['wrong test points',(root)=>{root.children.find(n=>n.tag==='judging').children[0].children.find(n=>n.tag==='tests').children[0].attributes.points='99';}],
  ['wrong group policy',(root)=>{root.children.find(n=>n.tag==='judging').children[0].children.find(n=>n.tag==='groups').children[0].attributes['points-policy']='each-test';}],
  ['wrong time limit',(root)=>{root.children.find(n=>n.tag==='judging').children[0].children.find(n=>n.tag==='time-limit').text='2000';}],
  ['lost percentage flag',(root)=>{root.children.find(n=>n.tag==='judging').attributes['treat-points-from-checker-as-percent']='false';}],
  ['wrong compiler',(root)=>{root.children.find(n=>n.tag==='assets').children.find(n=>n.tag==='solutions').children[0].children[0].attributes.type='cpp.g++17';}],
  ['lost grader linkage',(root)=>{const file=root.children.find(n=>n.tag==='files').children.find(n=>n.tag==='resources').children[0];delete file.attributes['for-types'];file.children=[];}],
  ['altered source bytes',(root,contents)=>{contents['solutions/main.cpp']='corrupted';}],
  ['lost extra tags',(root)=>{root.children.find(n=>n.tag==='assets').children.find(n=>n.tag==='solutions').children[1].children[1].children=[];}]
]) test('built descriptor read-back rejects '+title,async()=>{
  const e=environment({percent:true,grader:true,extraTags:true});e.build.transformArchive=transform;
  await assert.rejects(()=>e.run());assert.equal(e.mock.state.commits,1);
});

test('wrong solutions can have WA results without failing verification when their expected tags match',async()=>{
  const e=environment({extraTags:true,mutate({solutions}){solutions[1].children.find(n=>n.tag==='extra-tags').children=[];}});
  const result=await e.run();assert.equal(result.verification.state,'verified');
  assert(e.build.records[0].detail.runs.some(run=>run.verdict==='WA'));
});
