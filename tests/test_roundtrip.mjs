import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, n } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { createMockI18n } from './helpers/i18n.mjs';
import { assertNoDataWrites } from './helpers/noop.mjs';

const wrote = mock => mock.calls.some(call=>/^(?:save|set|delete|clear|enable|edit|updateInfo|problem\.create)/.test(call.method));
async function blocked(options) {
  const mock=createPolygon();
  await assert.rejects(()=>fixture(options).upload(mock));
  assert.equal(wrote(mock),false);return mock;
}

test('F01: padded public examples and interaction logs survive upload',async()=>{
  const f=fixture({interactive:true,twice:true,padded:true}),mock=createPolygon();
  const plan=await f.parse();assert(plan.tests[0].sampleInputPath.endsWith('example.01'));
  await f.upload(mock);
  assert.equal(mock.state.tests.get(1).inputForStatement,'PUBLIC SAMPLE\n');
  assert.equal(mock.state.tests.get(1).outputForStatement,'PUBLIC OUTPUT\n');
  assert.equal(mock.state.tests.get(1).interactionLogForStatement,'? PUBLIC QUESTION\n! PUBLIC ANSWER\n');
  assert.equal(mock.state.tests.get(1).input,'1\n');
  assert.equal(mock.state.info.useInteractionLogInExampleTests,true);
});

test('equivalent sample numbering is accepted; conflicting aliases and languages fail before writes',async()=>{
  const same=fixture({padded:true,mutate({contents}){contents['statement-sections/english/example.001']=contents['statement-sections/english/example.01'];}});
  assert((await same.parse()).tests[0].sampleInputPath);
  await blocked({padded:true,mutate({contents}){contents['statement-sections/english/example.1']='different';}});
  await blocked({mutate({contents}){contents['statement-sections/english/example.999']='orphan';}});
  await blocked({mutate({root,contents}){
    root.children.find(x=>x.tag==='statements').children.push(n('statement',{language:'korean'}));
    contents['statement-sections/korean/name.tex']='Title';contents['statement-sections/korean/legend.tex']='Legend';
    contents['statement-sections/korean/example.01']='conflicting';
  }});
});

test('F02: checker percentage is enabled after points and reset before disabling them',async()=>{
  const mock=createPolygon();await fixture({percent:true}).upload(mock);
  assert.equal(mock.state.checkerPercent,true);
  assert(mock.calls.findIndex(c=>c.method==='enablePoints')<mock.calls.findIndex(c=>c.method==='enableTreatPointsFromCheckerAsPercent'));
  const start=mock.calls.length;
  await fixture({groups:false}).upload(mock,'replace');
  const calls=mock.calls.slice(start);
  assert.equal(mock.state.checkerPercent,false);assert.equal(mock.state.pointsEnabled,false);
  assert(calls.findIndex(c=>c.method==='enableTreatPointsFromCheckerAsPercent')<calls.findIndex(c=>c.method==='enablePoints'));
  await blocked({percent:true,groups:false});
});

test('F03: compiler-only differences produce metadata-only updates, never a silent downgrade',async()=>{
  const f=fixture({interactive:true,twice:true}),mock=createPolygon();await f.upload(mock);
  for(const props of mock.state.fileMetadata.source.values())props.sourceType='cpp.g++17';
  mock.state.solutions.get('main.cpp').sourceType='cpp.g++17';
  const start=mock.calls.length;await f.upload(mock,'replace');
  const saves=mock.calls.slice(start).filter(c=>['saveFile','saveSolution'].includes(c.method));
  assert.equal(saves.length,3);
  assert(saves.every(c=>c.args.sourceType==='cpp.gcc13-64-winlibs-g++20' && !Object.hasOwn(c.args,'file')));
  assert.equal(mock.state.solutions.get('main.cpp').sourceType,'cpp.gcc13-64-winlibs-g++20');
  assert([...mock.state.fileMetadata.source.values()].every(x=>x.sourceType==='cpp.gcc13-64-winlibs-g++20'));
});

test('an ignored compiler setting fails read-back verification before commit',async()=>{
  const f=fixture({}),mock=createPolygon();await f.upload(mock);
  mock.state.solutions.get('main.cpp').sourceType='cpp.g++17';
  const original=mock.api.problem,commits=mock.state.commits;
  mock.api.problem=(method,id,args,options)=>original(method,id,
    method==='saveSolution'?{...args,sourceType:'cpp.g++17'}:args,options);
  await assert.rejects(()=>f.upload(mock,'replace'));
  assert.equal(mock.state.commits,commits);
});

test('F04: grader linkage is restored and can be removed without re-uploading content',async()=>{
  const f=fixture({grader:true}),mock=createPolygon();await f.upload(mock);
  assert.deepEqual(mock.state.fileMetadata.resource.get('grader.cpp').resourceAdvancedProperties,
    {forTypes:'cpp.*',stages:['COMPILE'],assets:['SOLUTION'],main:false});
  const next=fixture({grader:true,mutate({root}){
    const resource=root.children.find(x=>x.tag==='files').children.find(x=>x.tag==='resources').children[0];
    delete resource.attributes['for-types'];resource.children=[];
  }});
  const start=mock.calls.length;await next.upload(mock,'replace');
  const update=mock.calls.slice(start).find(c=>c.method==='saveFile'&&c.args.name==='grader.cpp');
  assert.equal(update.args.forTypes,'');assert(!Object.hasOwn(update.args,'file'));
  assert.equal(mock.state.fileMetadata.resource.get('grader.cpp').resourceAdvancedProperties,undefined);
});

test('unsupported grader phases cannot be silently dropped',async()=>{
  await blocked({grader:true,mutate({root}){
    root.children.find(x=>x.tag==='files').children.find(x=>x.tag==='resources').children[0]
      .children.find(x=>x.tag==='stages').children[0].attributes.name='run';
  }});
});

test('F05: per-group and per-testset expectations are restored, updated, and cleared',async()=>{
  const f=fixture({extraTags:true}),mock=createPolygon();await f.upload(mock);
  assert.deepEqual(mock.state.solutionExtraTags.get('partial.cpp'),[{testGroup:'A',tag:'OK'}]);
  const next=fixture({extraTags:true,mutate({solutions}){
    const extras=solutions[1].children.find(x=>x.tag==='extra-tags');
    extras.children=[n('extra-tag',{group:'A',tag:'wrong-answer'}),n('extra-tag',{testset:'tests',tag:'rejected'})];
  }});
  await next.upload(mock,'replace');
  assert.deepEqual(mock.state.solutionExtraTags.get('partial.cpp'),[{testGroup:'A',tag:'WA'},{testset:'tests',tag:'RJ'}]);
  const empty=fixture({extraTags:true,mutate({solutions}){solutions[1].children=solutions[1].children.filter(x=>x.tag!=='extra-tags');}});
  await empty.upload(mock,'replace');assert.deepEqual(mock.state.solutionExtraTags.get('partial.cpp'),[]);
  const start=mock.calls.length,result=await empty.upload(mock,'replace');
  assertNoDataWrites(result,mock.calls.slice(start));
});

test('F06: hidden memberships are re-read so ungrouped tests are cleared on the first attempt',async()=>{
  const first=fixture({omitSamples:true,mutate({ts,tests}){
    tests[1].attributes.group='B';ts.children.find(x=>x.tag==='groups').children=[n('group',{name:'A'}),n('group',{name:'B'})];
  }}),mock=createPolygon();await first.upload(mock);mock.state.groupsEnabled=false;
  const next=fixture({omitSamples:true,mutate({ts,tests}){
    tests[1].attributes.group='';ts.children.find(x=>x.tag==='groups').children=[n('group',{name:'A'})];
  }});
  assert.equal((await next.upload(mock,'replace')).committed,true);
  assert.equal(mock.state.tests.get(2).group,'');
});

test('F07: multiple source validators and existing extra validators block unsupported overwrites',async()=>{
  await blocked({secondValidator:true});
  const f=fixture({}),mock=createPolygon();await f.upload(mock);mock.state.extraValidators=['other.cpp'];
  const start=mock.calls.length;await assert.rejects(()=>f.upload(mock,'replace'));
  assert.equal(wrote({calls:mock.calls.slice(start)}),false);
});

test('F08/F13: obsolete judge tests are removed and validator context is preserved',async()=>{
  const f=fixture({selfTests:true}),mock=createPolygon();await f.upload(mock);
  assert.equal(mock.state.validatorTests[0].group,'A');assert.equal(mock.state.validatorTests[0].testset,'tests');
  mock.state.validatorTests.push({index:7,input:'old',expectedVerdict:'INVALID',group:'A',testset:'tests'});
  mock.state.checkerTests.push({index:9,input:'old',output:'old',answer:'old',expectedVerdict:'OK'});
  await f.upload(mock,'replace');assert.equal(mock.state.validatorTests.length,1);assert.equal(mock.state.checkerTests.length,0);
  const clear=fixture({selfTests:true,mutate({validator}){delete validator.children.find(x=>x.tag==='testset').children.find(x=>x.tag==='tests').children[0].attributes.group;}});
  const start=mock.calls.length;await clear.upload(mock,'replace');
  assert.equal(mock.state.validatorTests[0].group,'');
  assert(mock.calls.slice(start).some(c=>c.method==='deleteValidatorTest'));
  await fixture({selfTests:false}).upload(mock,'replace');assert.equal(mock.state.validatorTests.length,0);
});

for(const parameter of ['testInputForStatements','testOutputForStatements','testInteractionLogForStatements'])
  test('F09: an ignored/corrupt preview body blocks commit: '+parameter,async()=>{
    const f=fixture({interactive:true}),mock=createPolygon(),original=mock.api.problem;
    mock.api.problem=(method,id,args,options)=>original(method,id,
      method==='saveTest'&&args[parameter]?{...args,[parameter]:'CORRUPTED'}:args,options);
    await assert.rejects(()=>f.upload(mock));assert.equal(mock.state.commits,0);
  });

test('F11: missing main solution is rejected before creating a problem',async()=>{
  await blocked({noMain:true});
});

test('F12: missing generated sample data clears previous previews rather than retaining them',async()=>{
  const mock=createPolygon();await fixture({interactive:true,generated:true}).upload(mock);
  await fixture({interactive:true,generated:true,omitSamples:true}).upload(mock,'replace');
  assert.equal(mock.state.tests.get(1).inputForStatement,'');
  assert.equal(mock.state.tests.get(1).outputForStatement,'');
  assert.equal(mock.state.tests.get(1).interactionLogForStatement,'');
  assert.equal(mock.state.info.useInteractionLogInExampleTests,false);
});

test('new preflight failures are actionable in English and Korean',async()=>{
  for(const locale of ['en','ko']) {
    chrome.i18n=createMockI18n(locale);
    for(const options of [{noMain:true},{secondValidator:true},{groups:false,percent:true}]) {
      await assert.rejects(()=>fixture(options).parse(),error=>{
        assert.equal(/[가-힣]/.test(error.message),locale==='ko');return true;
      });
    }
  }
});


test('hidden group dependencies cannot block replacement with an ordinary problem',async()=>{
  const mock=createPolygon();
  const grouped=fixture({generated:true,mutate({ts,tests}){
    tests[1].attributes.group='B';
    ts.children.find(x=>x.tag==='groups').children=[n('group',{name:'A'}),
      n('group',{name:'B'},[n('dependencies',{},[n('dependency',{group:'A'})])])];
  }});
  await grouped.upload(mock);mock.state.groupsEnabled=false;
  await fixture({groups:false}).upload(mock,'replace');
  assert.equal(mock.state.groupsEnabled,false);
  assert.equal(mock.state.tests.get(1).manual,true);
  assert.equal(mock.state.tests.get(2).manual,true);
  assert(![...mock.state.groups.values()].some(group=>group.dependencies.length));
});


test('generic C++20 package types use a native API ID without changing names, bytes or tags',async()=>{
  const f=fixture({interactive:true,generated:true,extraTags:true}),mock=createPolygon();
  const original=mock.api.problem;
  mock.api.problem=(method,id,args={},options)=>{
    if (['saveFile','saveSolution'].includes(method) && args.sourceType==='cpp.g++20')
      throw Error('problem.'+method+": sourceType: Unknown file type 'cpp.g++20'.");
    return original(method,id,args,options);
  };
  const expected='cpp.gcc13-64-winlibs-g++20';
  const before=await f.parse();
  assert(before.sources.every(file=>file.sourceType==='cpp.g++20'));
  await f.upload(mock);
  const writes=mock.calls.filter(call=>['saveFile','saveSolution'].includes(call.method)&&call.args.sourceType);
  assert(writes.length>=4);
  assert(writes.every(call=>call.args.sourceType===expected));
  assert.equal(mock.state.files.source.get('val.cpp'),f.contents['files/val.cpp']);
  assert.equal(mock.state.solutions.get('main.cpp').file,f.contents['solutions/main.cpp']);
  assert.equal(mock.state.solutions.get('main.cpp').tag,'MA');
  assert.equal(mock.state.solutions.get('partial.cpp').tag,'WA');
  assert.deepEqual(await f.parse(),before,'original package metadata is never rewritten');
  const start=mock.calls.length;
  const result=await f.upload(mock,'replace');
  assertNoDataWrites(result,mock.calls.slice(start));
});

test('compiler alias mapping does not silently retry unknown compiler IDs or network failures',async()=>{
  for(const failure of ["sourceType: Unknown file type 'cpp.future99'.",'network response lost']) {
    const f=fixture({mutate({validator}){validator.children[0].attributes.type='cpp.future99';}}),mock=createPolygon();
    const original=mock.api.problem;let attempts=0;
    mock.api.problem=(method,id,args={},options)=>{
      if(method==='saveFile'&&args.name==='val.cpp'){
        attempts++;assert.equal(args.sourceType,'cpp.future99');throw Error(failure);
      }
      return original(method,id,args,options);
    };
    await assert.rejects(()=>f.upload(mock),error=>error.message===failure);
    assert.equal(attempts,1);assert.equal(mock.state.commits,0);
  }
});
