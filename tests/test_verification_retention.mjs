import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { attachBuild } from './helpers/build.mjs';
import { installNativeTestParser } from './helpers/native-xml.mjs';
import { executeImport } from '../src/polygon/import.js';

function environment() {
  const f=fixture(),mock=createPolygon(),build=attachBuild(mock),saved=[];
  let checkpoint=null,problemId=null;
  return {mock,build,saved,get checkpoint(){return checkpoint;},
    run(options={}) {
      installNativeTestParser();
      return executeImport({api:mock.api,
        job:{file:f.file,mode:problemId?'replace':'create',problemId,commit:true,verify:true,verification:checkpoint},
        onCreated:async id=>{problemId=String(id);},
        onCheckpoint:async value=>{checkpoint=structuredClone(value);saved.push(structuredClone(value));},
        verificationOptions:{maxPolls:2,pollMs:0,sleep:async()=>{},...options}});
    }};
}
function history(e,count) {
  for(let i=0;i<count;i++)e.build.records.push({pkg:{id:1000+i,revision:1,state:'READY',comment:'',type:'standard'},detail:{invocation:{id:10000+i}}});
}

test('pinning a package drops historical IDs from subsequent durable checkpoints',async()=>{
  const e=environment();history(e,3000);
  assert.equal((await e.run()).verification.state,'verified');
  assert.equal(e.saved[0].beforeIds.length,3000,'Unknown outcome recovery still needs the launch snapshot');
  for(const saved of e.saved.filter(value=>value.packageId!=null))
    assert.deepEqual(saved.beforeIds,[],'Pinned checkpoint retained every old build ID');
});

test('lost build replies keep history until recovery, then compact without a second build',async()=>{
  const e=environment();history(e,1000);e.build.loseBuildResponse=true;
  await assert.rejects(e.run,/Build response lost/);
  assert.equal(e.checkpoint.beforeIds.length,1000);
  assert.equal((await e.run()).verification.state,'verified');
  assert.equal(e.checkpoint.beforeIds.length,0);
  assert.equal(e.build.builds,1);assert.equal(e.mock.state.commits,1);
});

test('a changed revision is rejected before downloading a built ZIP',async()=>{
  const e=environment();e.build.afterBuild=()=>{e.mock.state.entry.revision++;e.mock.state.entry.workingCopyRevision++;};
  await assert.rejects(e.run);
  assert.equal(e.mock.calls.filter(call=>call.method==='package').length,0,'Downloaded an already stale package');
  assert.equal(e.mock.calls.filter(call=>call.method==='invocation').length,0,'Downloaded stale full run details');
});

test('working-copy changes during a long running build stop polling before its full budget',async()=>{
  const e=environment();let sleeps=0;
  e.build.afterBuild=record=>{record.pkg.state='RUNNING';};
  await assert.rejects(()=>e.run({maxPolls:30,revisionCheckEvery:4,sleep:async()=>{sleeps++;e.mock.state.entry.modified=true;}}));
  assert(sleeps<=4,'Kept polling an invalidated verification for '+sleeps+' delays');
  assert.equal(e.build.builds,1);assert.equal(e.mock.state.commits,1);
});

test('checkpoint pin is validated before querying package history',async()=>{
  const e=environment();e.build.afterBuild=record=>{record.pkg.state='RUNNING';};
  await assert.rejects(e.run);
  e.checkpoint.packageId=-1;
  const start=e.mock.calls.length;await assert.rejects(e.run);
  assert(!e.mock.calls.slice(start).some(call=>call.method==='packages'),'Invalid checkpoint triggered package fetch');
});


test('legacy pinned checkpoints are compacted and resume without a new build',async()=>{
  const e=environment();history(e,20);e.build.afterBuild=record=>{record.pkg.state='RUNNING';};
  await assert.rejects(e.run);
  e.checkpoint.beforeIds=Array.from({length:20},(_,i)=>1000+i);
  e.build.records.at(-1).pkg.state='READY';
  assert.equal((await e.run()).verification.state,'verified');
  assert.equal(e.build.builds,1);assert.equal(e.checkpoint.beforeIds.length,0);
});

test('missing pinned packages never trigger replacement builds',async()=>{
  const e=environment();e.build.afterBuild=record=>{record.pkg.state='RUNNING';};
  await assert.rejects(e.run);e.build.records.length=0;
  await assert.rejects(e.run);assert.equal(e.build.builds,1);
});

test('a final revision check remains mandatory after descriptor verification',async()=>{
  const e=environment(),problem=e.mock.api.problem;
  e.mock.api.problem=async(method,...args)=>{
    const result=await problem(method,...args);
    if(method==='package'){e.mock.state.entry.revision++;e.mock.state.entry.workingCopyRevision++;}
    return result;
  };
  await assert.rejects(e.run);
  assert.equal(e.checkpoint.stage,'polling');
});

test('periodic revision checks add bounded small reads without re-downloading run details',async()=>{
  const e=environment();e.build.afterBuild=record=>{record.pkg.state='RUNNING';};
  await assert.rejects(()=>e.run({maxPolls:25,revisionCheckEvery:12}));
  assert.equal(e.mock.calls.filter(call=>call.method==='problems.list').length,3);
  assert.equal(e.mock.calls.filter(call=>call.method==='invocation').length,0);
});
