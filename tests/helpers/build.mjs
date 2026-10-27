import assert from 'node:assert/strict';
import { makeZip } from './zip.mjs';
import { n, xml } from './format-fixture.mjs';
import { TAGS } from '../../src/package/metadata.js';
const tagName = code => Object.keys(TAGS).find(key=>TAGS[key]===code);
const clone = value => structuredClone(value);

function builtArchive(state, transform) {
  const contents = {}, source = (name,type,path='files/'+name) => n('source',{path,...(type?{type}:{})});
  const executables = [];
  for (const [name,body] of state.files.source) {
    contents['files/'+name]=body;
    executables.push(n('executable',{},[source(name,state.fileMetadata.source.get(name)?.sourceType)]));
  }
  const resources = [];
  for (const [name,body] of state.files.resource) {
    contents['files/'+name]=body;
    const properties=state.fileMetadata.resource.get(name)?.resourceAdvancedProperties;
    resources.push(n('file',{path:'files/'+name,...(properties?{'for-types':properties.forTypes}:{})},properties?[
      n('stages',{},properties.stages.map(value=>n('stage',{name:value.toLowerCase()}))),
      n('assets',{},properties.assets.map(value=>n('asset',{name:value.toLowerCase()})))
    ]:[]));
  }
  const auxiliary = [];
  for (const [name,body] of state.files.aux) {contents['files/'+name]=body;auxiliary.push(n('file',{path:'files/'+name}));}
  const solutions = [];
  for (const [name,value] of state.solutions) {
    contents['solutions/'+name]=value.file;
    const extras=(state.solutionExtraTags.get(name)||[]).map(extra=>n('extra-tag',{
      tag:tagName(extra.tag),...(extra.testGroup?{group:extra.testGroup}:{testset:extra.testset})
    }));
    solutions.push(n('solution',{tag:tagName(value.tag)},[
      source(name,value.sourceType,'solutions/'+name),n('extra-tags',{},extras)
    ]));
  }
  const asset = (name,kind) => source(name,state.fileMetadata.source.get(name)?.sourceType);
  const assets = [n('solutions',{},solutions),n('validators',{},state.validator?[n('validator',{},[asset(state.validator)])]:[])];
  if (state.checker) assets.push(state.checker.startsWith('std::')?n('checker',{name:state.checker}):n('checker',{},[asset(state.checker)]));
  if (state.info.interactive) assets.push(n('interactor',{},[asset(state.interactor),
    n('runs',{},[n('run',{},[],'1'),...(state.info.interactiveSecondRun?[n('run',{},[],'2')]:[])])]));
  const tests = [...state.tests.values()].sort((a,b)=>a.index-b.index).map(test=>n('test',{
    method:test.manual?'manual':'generated',sample:String(!!test.useInStatements),description:test.description||'',
    ...(test.manual?{}:{cmd:test.scriptLine.replace(/\s+>\s+\d+$/,'')}),
    ...(state.groupsEnabled&&test.group?{group:test.group}:{}),
    ...(state.pointsEnabled&&test.points!=null?{points:String(test.points)}:{})
  }));
  const groupNodes=state.groupsEnabled?[...state.groups.values()].map(group=>n('group',{
    name:group.name,'points-policy':group.pointsPolicy.toLowerCase().replaceAll('_','-'),
    'feedback-policy':group.feedbackPolicy.toLowerCase()
  },[n('dependencies',{},group.dependencies.map(name=>n('dependency',{group:name})))])):[];
  const root=n('problem',{'short-name':'verified-fixture'},[
    n('files',{},[n('executables',{},executables),n('resources',{},resources),n('auxiliary-files',{},auxiliary)]),
    n('assets',{},assets),n('judging',{'run-count':state.info.runTwice?'2':'1',
      'input-file':state.info.inputFile,'output-file':state.info.outputFile,
      'treat-points-from-checker-as-percent':String(state.checkerPercent)
    },[n('testset',{name:'tests'},[
      n('time-limit',{},[],String(state.info.timeLimit)),n('memory-limit',{},[],String(state.info.memoryLimit*1024*1024)),
      n('tests',{},tests),n('groups',{},groupNodes)
    ])])
  ]);
  transform?.(root,contents);
  contents['problem.xml']=xml(root);
  return new Blob([makeZip(contents)],{type:'application/zip'});
}

// Native API-shaped results and a real XML descriptor; no compiler is executed
// here. The caller can inject server build failures and corrupt stored results.
export function attachBuild(mock) {
  const original=mock.api.problem;
  const controller={records:[],builds:0,afterBuild:null,transformArchive:null,loseBuildResponse:false,noBuildResult:false};
  mock.api.problem=async(method,id,args={},options={})=>{
    if(method==='commitChanges') {
      const result=await original(method,id,args,options);
      mock.state.entry.revision++;mock.state.entry.workingCopyRevision=mock.state.entry.revision;
      return result;
    }
    if(!['buildPackage','packages','invocations','invocation','package'].includes(method))return original(method,id,args,options);
    mock.calls.push({method,args:clone(args)});
    if(method==='buildPackage') {
      assert.equal(mock.state.entry.modified,false);assert.deepEqual(args,{full:'false',verify:'true'});
      const state=clone(mock.state),packageId=100+(++controller.builds);
      const invoked=[...state.solutions.values()].filter(solution=>{
        const extras=state.solutionExtraTags.get(solution.name)||[];
        return (extras.find(tag=>tag.testset==='tests')?.tag||solution.tag)!=='NR'||extras.some(tag=>tag.testGroup&&tag.tag!=='NR');
      });
      const pkg={id:packageId,revision:state.entry.revision,state:'READY',comment:'',type:'standard'};
      const invocation={id:packageId+1000,packageId,testset:'tests',status:'FINISHED',violateTag:false,
        solutions:invoked.map(value=>value.name),tests:[...state.tests.keys()]};
      const solutionTags=invoked.map(solution=>({name:solution.name,tag:solution.tag,
        testsetTags:Object.fromEntries((state.solutionExtraTags.get(solution.name)||[]).filter(tag=>tag.testset).map(tag=>[tag.testset,tag.tag])),
        groupTags:Object.fromEntries((state.solutionExtraTags.get(solution.name)||[]).filter(tag=>tag.testGroup).map(tag=>[tag.testGroup,tag.tag]))}));
      const runs=invoked.flatMap(solution=>[...state.tests.values()].map(test=>{
        const extra=state.solutionExtraTags.get(solution.name)||[];
        const tag=extra.find(tag=>tag.testGroup===test.group)?.tag||extra.find(tag=>tag.testset==='tests')?.tag||solution.tag;
        return {id:solution.name+':'+test.index,solution:solution.name,test:test.index,
          verdict:['MA','OK','TO'].includes(tag)?'OK':'WA',timeMillis:1,memoryBytes:1024,violateTag:false};
      }));
      const record={pkg,detail:{invocation,solutionTags,runs},archive:builtArchive(state,controller.transformArchive)};
      controller.afterBuild?.(record);
      controller.records.push(record);
      if(controller.loseBuildResponse){controller.loseBuildResponse=false;throw Error('Build response lost');}
      return controller.noBuildResult?undefined:clone(record.pkg);
    }
    if(method==='packages')return controller.records.map(record=>clone(record.pkg));
    if(method==='invocations')return controller.records.filter(record=>record.pkg.id===Number(args.packageId)).map(record=>clone(record.detail.invocation));
    if(method==='invocation')return clone(controller.records.find(record=>record.detail.invocation.id===Number(args.invocationId)).detail);
    if(method==='package') {assert.equal(options.binary,true);return controller.records.find(record=>record.pkg.id===Number(args.packageId)).archive;}
  };
  return controller;
}
