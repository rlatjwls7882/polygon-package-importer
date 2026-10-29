import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, n } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { attachBuild } from './helpers/build.mjs';
import { installNativeTestParser } from './helpers/native-xml.mjs';
import { makeZip } from './helpers/zip.mjs';
import { executeImport } from '../src/polygon/import.js';
import { ZipArchive } from '../src/package/zip.js';

async function environment(options = {}) {
  const f=fixture(options),mock=createPolygon(),build=attachBuild(mock);
  const run=async({file=f.file, mode='replace', verify=false}={})=>{
    installNativeTestParser();
    return executeImport({api:mock.api,job:{file,mode,problemId:42,commit:true,verify},
      verificationOptions:{maxPolls:2,pollMs:0,sleep:async()=>{}}});
  };
  await run({mode:'create',verify:true});mock.calls.length=0;
  return {f,mock,build,run,calls:method=>mock.calls.filter(call=>call.method===method)};
}

for (const options of [
  {groups:false}, {interactive:true,twice:true,extraTags:true,grader:true},
  {percent:true,extraTags:true}, {generated:true,extraTags:true,omitSamples:true}
]) test('clean current-revision package avoids body reads and opaque resets: '+JSON.stringify(options),async()=>{
  const e=await environment(options),commits=e.mock.state.commits;
  const result=await e.run({verify:true});
  assert.equal(result.mutations,0);assert.equal(result.committed,true);
  assert.equal(result.verification.state,'verified');
  assert.equal(e.mock.state.commits,commits);
  assert.equal(e.build.builds,2,'Every new upload still launches a fresh verified build');
  for (const method of ['viewFile','viewSolution','editSolutionExtraTags','enableTreatPointsFromCheckerAsPercent'])
    assert.equal(e.calls(method).length,0,method);
  assert(e.calls('tests').every(call=>call.args.noInputs==='true'));
  assert.equal(e.calls('info').length,1,'No judging re-read without a judging mutation');
  assert.equal(e.calls('files').length,1);assert.equal(e.calls('solutions').length,1);
});

for (const reason of ['dirty','old-revision','warning','missing-standard','malformed-rows','download-error','descriptor-revision','missing-source','bad-crc'])
  test('unusable optional package falls back to live comparisons: '+reason,async()=>{
    const e=await environment({groups:false}),record=e.build.records[0];
    if(reason==='dirty')e.mock.state.entry.modified=true;
    if(reason==='old-revision')record.pkg.revision--;
    if(reason==='warning')record.pkg.comment='Warning: something changed';
    if(reason==='missing-standard')record.pkg.type='linux';
    const original=e.mock.api.problem;
    e.mock.api.problem=async(method,...args)=>{
      if(reason==='malformed-rows'&&method==='packages')return [{id:101,revision:2,state:'READY',type:'invalid'}];
      if(reason==='download-error'&&method==='package')throw Error('Read transport unavailable');
      return original(method,...args);
    };
    if(['descriptor-revision','missing-source','bad-crc'].includes(reason)) {
      const archive=await ZipArchive.fromFile(record.archive),contents={};
      for(const name of archive.names())contents[name]=await archive.bytes(name);
      archive.dispose();
      if(reason==='descriptor-revision')contents['problem.xml']=new TextDecoder().decode(contents['problem.xml']).replace(/revision="\d+"/,'revision="999"');
      if(reason==='missing-source')delete contents['files/val.cpp'];
      const bytes=new Uint8Array(makeZip(contents));
      if(reason==='bad-crc')bytes[30+new TextEncoder().encode(Object.keys(contents)[0]).length]^=1;
      record.archive=new Blob([bytes]);
    }
    const result=await e.run();
    assert.equal(result.verification.state,'not-run');
    assert(e.calls('viewSolution').length>0);
    assert(e.calls('tests').some(call=>call.args.noInputs==='false'));
    assert(e.calls('editSolutionExtraTags').length>0,'Unknown opaque state is still explicitly reconciled');
    if(reason==='dirty')assert.equal(e.calls('packages').length,0);
  });

test('the latest working-copy check rejects a change during snapshot download before any write',async()=>{
  const e=await environment({groups:false}),original=e.mock.api.problem,commits=e.mock.state.commits;
  e.mock.api.problem=async(method,...args)=>{
    const result=await original(method,...args);
    if(method==='package')e.mock.state.entry.modified=true;
    return result;
  };
  await assert.rejects(()=>e.run());
  assert.equal(e.mock.state.commits,commits);
  assert(!e.mock.calls.some(call=>/^(save|set|delete|enable|edit|updateInfo)/.test(call.method)));
});

test('a changed manual input is compared to the snapshot and read back without file/judging queries',async()=>{
  const e=await environment({groups:false});
  const changed=fixture({groups:false,mutate({contents}){contents['tests/02']='CHANGED INPUT\n';}});
  const result=await e.run({file:changed.file});
  assert.equal(result.testMutations,1);assert.equal(e.mock.state.tests.get(2).input,'CHANGED INPUT\n');
  assert.equal(e.calls('saveTest').length,1);assert.equal(e.calls('tests').length,2);
  assert(e.calls('tests').every(call=>call.args.noInputs==='true'));
  assert.equal(e.calls('info').length,1);assert.equal(e.calls('files').length,1);assert.equal(e.calls('solutions').length,1);
});

test('solution-only changes re-read solution compiler metadata and catch a broken setter before commit',async()=>{
  for(const corrupt of [false,true]) {
    const e=await environment({groups:false}),commits=e.mock.state.commits,original=e.mock.api.problem;
    e.mock.api.problem=async(method,id,args,options)=>{
      const result=await original(method,id,args,options);
      if(corrupt&&method==='saveSolution')e.mock.state.solutions.get(args.name).sourceType='unknown';
      return result;
    };
    const changed=fixture({groups:false,mutate({contents}){contents['solutions/main.cpp']+='\n// changed';}});
    if(corrupt){await assert.rejects(()=>e.run({file:changed.file}));assert.equal(e.mock.state.commits,commits);}
    else await e.run({file:changed.file});
    assert.equal(e.calls('solutions').length,2);assert.equal(e.calls('files').length,1);assert.equal(e.calls('info').length,1);
  }
});

test('source-only changes re-read source metadata without fetching solution metadata twice',async()=>{
  const e=await environment({groups:false});
  const changed=fixture({groups:false,mutate({contents}){contents['files/val.cpp']+='\n// changed';}});
  await e.run({file:changed.file});
  assert.equal(e.calls('saveFile').length,1);assert.equal(e.calls('files').length,2);
  assert.equal(e.calls('solutions').length,1);assert.equal(e.calls('info').length,1);
});

test('judging changes still receive an independent API read-back',async()=>{
  const e=await environment({groups:false});
  const changed=fixture({groups:false,twice:true});
  await e.run({file:changed.file});
  assert.equal(e.mock.state.info.runTwice,true);assert.equal(e.calls('info').length,2);
  assert.equal(e.calls('files').length,1);assert.equal(e.calls('solutions').length,1);
});

test('a known obsolete extra tag is removed once without resetting other scopes',async()=>{
  const e=await environment({mutate({solutions}){
    solutions[0].children.push(n('extra-tags',{},[n('extra-tag',{testset:'tests',tag:'accepted'})]));
  }});
  await e.run({file:fixture().file});
  assert.equal(e.calls('editSolutionExtraTags').length,1);
  assert.deepEqual(e.mock.state.solutionExtraTags.get('main.cpp'),[]);
});

test('recreated groups invalidate the tag snapshot and restore expected group tags',async()=>{
  const e=await environment({generated:true,extraTags:true,omitSamples:true}),original=e.mock.api.problem;
  e.mock.api.problem=async(method,...args)=>{
    const result=await original(method,...args);
    if(method==='clearScript')for(const [name,tags] of e.mock.state.solutionExtraTags)
      e.mock.state.solutionExtraTags.set(name,tags.filter(tag=>!tag.testGroup));
    return result;
  };
  const changed=fixture({generated:true,extraTags:true,omitSamples:true,mutate({tests}){tests[0].attributes.cmd='gen 999';}});
  await e.run({file:changed.file,verify:true});
  assert(e.calls('editSolutionExtraTags').some(call=>call.args.testGroup==='A'&&call.args.remove==='false'));
  assert.equal(e.build.builds,2);
});

test('snapshot archives are disposed after a mutation failure',async()=>{
  const e=await environment({groups:false}),dispose=ZipArchive.prototype.dispose,closed=[];
  ZipArchive.prototype.dispose=function(){closed.push(this);return dispose.call(this);};
  e.mock.state.fail={method:'saveTest'};
  try {
    const changed=fixture({groups:false,mutate({contents}){contents['tests/02']='CHANGED\n';}});
    await assert.rejects(()=>e.run({file:changed.file}));
    assert.equal(new Set(closed).size,2,'Both the selected ZIP and optional snapshot are disposed');
    assert(closed.every(archive=>archive.contents.buffer===null));
  } finally {ZipArchive.prototype.dispose=dispose;}
});

const duplicateBuild='problem.buildPackage: problemId: There is already non-failed package for this revision with verification.';
function refuseDuplicate(e, message=duplicateBuild, after=()=>{}) {
  e.build.records[0].pkg.comment='Package created in 100 ms with verification';
  const original=e.mock.api.problem;
  e.mock.api.problem=async(method,id,args,options)=>{
    if(method==='buildPackage'){e.mock.calls.push({method,args});after();throw Error(message);}
    return original(method,id,args,options);
  };
}

test('an explicit duplicate-build refusal on a no-op rechecks the existing package and all runs',async()=>{
  const e=await environment({groups:false});refuseDuplicate(e);
  const result=await e.run({verify:true});
  assert.equal(result.mutations,0);assert.equal(result.verification.existingBuild,true);
  assert.equal(result.verification.runs,2);assert.equal(e.build.builds,1);
  assert.equal(e.calls('buildPackage').length,1);assert.equal(e.calls('invocation').length,1);
  assert.equal(e.calls('package').length,2,'Comparison snapshot and final independent download');
});

for(const reason of ['unknown-error','changed-revision','ambiguous','warning','missing-runs','tag-violation','changed-upload'])
  test('existing-build fallback never accepts an unsafe candidate: '+reason,async()=>{
    const e=await environment({groups:false});
    refuseDuplicate(e,reason==='unknown-error'?duplicateBuild+' Network error':duplicateBuild,
      ()=>{if(reason==='changed-revision'){e.mock.state.entry.revision++;e.mock.state.entry.workingCopyRevision++;}});
    if(reason==='ambiguous')e.build.records.push({...e.build.records[0],pkg:{...e.build.records[0].pkg,id:999}});
    if(reason==='warning')e.build.records[0].pkg.comment='Package created in 100 ms with verification\nWarning: tags';
    if(reason==='missing-runs')e.build.records[0].detail.runs.pop();
    if(reason==='tag-violation')e.build.records[0].detail.invocation.violateTag=true;
    const file=reason==='changed-upload'?fixture({groups:false,mutate({contents}){contents['tests/02']='NEW INPUT\n';}}).file:e.f.file;
    await assert.rejects(()=>e.run({file,verify:true}));
  });

test('an existing-build checkpoint remains pinned on retry and never trusts a stored success report',async()=>{
  const e=await environment({groups:false});refuseDuplicate(e);
  let checkpoint;
  const job={file:e.f.file,mode:'replace',problemId:42,commit:true,verify:true};
  const run=verification=>executeImport({api:e.mock.api,job:{...job,verification},onCheckpoint:async value=>{checkpoint=structuredClone(value);},
    verificationOptions:{maxPolls:2,pollMs:0,sleep:async()=>{}}});
  installNativeTestParser();await run();
  assert.equal(checkpoint.existingBuild,true);assert.equal(checkpoint.beforeIds.length,0);
  const builds=e.calls('buildPackage').length;
  e.build.records[0].detail.runs[0].verdict='CE';
  await assert.rejects(()=>run(checkpoint));
  assert.equal(e.calls('buildPackage').length,builds,'Retry only follows the pinned existing package');
});

test('cached bodies keep the API decoding semantics for repeated leading BOMs',async()=>{
  const e=await environment({groups:false,mutate({contents}){
    contents['solutions/main.cpp']+='\n'.repeat(10);contents['files/val.cpp']+='\n'.repeat(10);
  }});
  e.mock.state.solutions.get('main.cpp').file='\uFEFF\uFEFF'+e.mock.state.solutions.get('main.cpp').file;
  e.mock.state.files.source.set('val.cpp','\uFEFF\uFEFF'+e.mock.state.files.source.get('val.cpp'));
  const remote=e.mock.state.tests.get(2);remote.input='\uFEFF\uFEFF'+remote.input;remote.inputBase64=Buffer.from(remote.input).toString('base64');
  e.build.records.length=0;
  await e.mock.api.problem('buildPackage',42,{full:'false',verify:'true'});
  e.mock.calls.length=0;
  await e.run();
  assert.equal(e.calls('saveFile').length,1);assert.equal(e.calls('saveSolution').length,1);assert.equal(e.calls('saveTest').length,1);
  assert(!e.mock.state.solutions.get('main.cpp').file.startsWith('\uFEFF'));
  assert(!e.mock.state.files.source.get('val.cpp').startsWith('\uFEFF'));
  assert(!e.mock.state.tests.get(2).input.startsWith('\uFEFF'));
});

test('a progress failure after duplicate refusal cannot lose the pinned existing-build checkpoint',async()=>{
  const e=await environment({groups:false});refuseDuplicate(e);let checkpoint;
  const job={file:e.f.file,mode:'replace',problemId:42,commit:true,verify:true};
  installNativeTestParser();
  await assert.rejects(()=>executeImport({api:e.mock.api,job,
    onCheckpoint:async value=>{checkpoint=structuredClone(value);},
    onProgress:async value=>{if(checkpoint?.existingBuild)throw Error('Progress channel lost');}
  }),/Progress channel lost/);
  assert.equal(checkpoint.existingBuild,true);assert.equal(checkpoint.packageId,e.build.records[0].pkg.id);
  assert.equal(checkpoint.stage,'polling');
  const result=await executeImport({api:e.mock.api,job:{...job,verification:checkpoint}});
  assert.equal(result.verification.existingBuild,true);assert.equal(e.calls('buildPackage').length,1);
});
