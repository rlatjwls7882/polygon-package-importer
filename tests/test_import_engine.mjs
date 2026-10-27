import { assertNoDataWrites } from './helpers/noop.mjs';
import { installDOMParser } from './helpers/xml.mjs';
import './helpers/i18n.mjs';
// Integration test of the new importer engine using a mock Polygon API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadPolygonPackage } from '../src/package/load.js';
import { ZipArchive } from '../src/package/zip.js';
import { executeImport } from '../src/polygon/import.js';

const [zipPath, treePath] = process.argv.slice(2);
const parsed=JSON.parse(await fs.readFile(treePath,'utf8'));

installDOMParser(parsed);

const bytes=await fs.readFile(zipPath);
const file={size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};
const archive=await ZipArchive.fromFile(file);
const plan=await loadPolygonPackage(archive);

function clone(obj){return JSON.parse(JSON.stringify(obj));}

async function buildMock() {
  const source=new Map();
  const solutions=new Map();
  const files={sourceFiles:[],resourceFiles:[],auxFiles:[]};
  for(const [kind,key,list] of [
    ['source','sourceFiles',plan.sources],
    ['resource','resourceFiles',plan.resources],
    ['aux','auxFiles',plan.aux]
  ]) for(const f of list){
    const body=await archive.text(f.path);
    source.set(kind+':'+f.name,body);
    files[key].push({name:f.name,length:new TextEncoder().encode(body).length,sourceType:f.sourceType,resourceAdvancedProperties:f.resourceAdvancedProperties});
  }
  const sols=[];
  for(const solution of plan.solutions){
    const body=await archive.text(solution.path);
    solutions.set(solution.name,body);
    sols.push({name:solution.name,length:new TextEncoder().encode(body).length,tag:solution.tag,sourceType:solution.sourceType});
  }
  const tests=[];
  for(const test of plan.tests){
    if(test.method==='manual'){
      const input=await archive.text(test.path);
      tests.push({index:test.index,manual:true,description:test.description,
        input, inputBase64:Buffer.from(input).toString('base64'),
        useInStatements:test.sample,
        ...(test.sample?{
          inputForStatement:input,
          outputForStatement:test.outputPath?await archive.text(test.outputPath):undefined
        }:{}),
        ...(test.group?{group:test.group}:{}),
        ...(test.points!==null?{points:test.points}:{})
      });
    } else {
      tests.push({index:test.index,manual:false,useInStatements:!!test.sample,
        description:test.description||''});
    }
  }
  const state={
    entry:{id:42,revision:1,workingCopyRevision:1,modified:false,
      deleted:false,accessType:'OWNER',name:'demo',owner:'me'},
    tests,files,solutions:sols,statements:Object.fromEntries(plan.statements.map(s=>[s.lang,clone(s)])),
    statementResources:[],
    tags:[...plan.tags], info:clone(plan.info),
    checker:plan.checker,validator:plan.validator,script:'gen 99 > 2',commit:0
  };
  const calls=[];
  const api={
    async call(method,args={}){
      calls.push(method);
      if(method==='problems.list') return [clone(state.entry)];
      if(method==='problem.create') return {id:42};
      throw Error('Unknown call: '+method);
    },
    async problem(method,id,args={},options={}){
      calls.push('problem.'+method);
      switch(method) {
        case 'info':return clone(state.info);
        case 'stresses':case 'extraValidators':case 'validatorTests':case 'checkerTests':return [];
        case 'editSolutionExtraTags':case 'enableTreatPointsFromCheckerAsPercent':return {};
        case 'files':return clone(state.files);
        case 'solutions':return clone(state.solutions);
        case 'statements':return clone(state.statements);
        case 'statementResources':return clone(state.statementResources);
        case 'tests':return clone(state.tests);
        case 'checker':return state.checker;
        case 'validator':return state.validator;
        case 'viewTags':return state.tags;
        case 'viewFile':return source.get(args.type+':'+args.name);
        case 'viewSolution':return solutions.get(args.name);
        case 'script':return state.script;
        case 'commitChanges':state.commit++;return {committed:true};
        case 'saveScript':
          state.script=args.source;
          if(!state.tests.some(t=>t.index===2))
            state.tests.push({index:2,manual:false,useInStatements:false,description:''});
          return {};
        case 'saveTest':return {};
        case 'saveTags':state.tags=args.tags.split(',');return {};
        case 'updateInfo':Object.assign(state.info,args);return {};
        case 'saveStatement':state.statements[args.lang]={...state.statements[args.lang],...args};return {};
        case 'saveFile': {
          if('file' in args)source.set(args.type+':'+args.name,args.file);
          const key={source:'sourceFiles',resource:'resourceFiles',aux:'auxFiles'}[args.type];
          const file=state.files[key].find(file=>file.name===args.name);
          if(args.sourceType && file)file.sourceType=args.sourceType;return {};
        }
        case 'saveSolution':solutions.set(args.name,args.file);return {};
        case 'deleteStatementResource':
          if(state.failDeletionName===args.name)throw Error('simulated statement resource deletion failure');
          state.statementResources=state.statementResources.filter(f=>f.name!==args.name);
          return {};
        case 'enableGroups':case 'enablePoints':case 'setChecker':case 'setValidator':
          return {};
        default:throw Error('Unexpected API call: '+method);
      }
    }
  };
  return {api,state,calls};
}

const job={file,filename:'test.zip',mode:'replace',problemId:'42',commit:true};
const a=await buildMock();
const logs=[];
const result=await executeImport({job,api:a.api,onProgress:async message=>logs.push(message)});
assert.equal(result.id,42);
assertNoDataWrites(result,a.calls);
assert.equal(result.committed,true);
assert.equal(a.state.commit,1);
assert.equal(logs.at(-1).progress,100);
assert(!a.calls.some(s=>/save|delete|updateInfo/.test(s)));
console.log('PASS: identical data is skipped; extra tags without a getter are reconciled explicitly');

const b=await buildMock();
b.state.tests=b.state.tests.filter(t=>t.index!==2);
const patched=await executeImport({job,api:b.api});
assert(patched.mutations>=1);
assert(b.calls.includes('problem.saveScript'));
assert(b.calls.includes('problem.commitChanges'));
assert.equal(b.state.commit,1);
console.log('PASS: missing generated test is restored and committed');

const c=await buildMock();
c.state.entry.accessType='READ';
await assert.rejects(()=>executeImport({job,api:c.api}),/쓰기 권한/);
assert(!c.calls.some(x=>x.startsWith('problem.save')||x.startsWith('problem.delete')));
console.log('PASS: read-only target is rejected before modification');


// The ZIP has no statement image attachments. Those from the old Polygon
// problem are independent of problem.files and must be removed on overwrite.
const images=await buildMock();
images.state.statementResources=[
  {name:'old-figure.png',length:1234},
  {name:'unused-diagram.svg',length:567}
];
const imageResult=await executeImport({job,api:images.api});
assert.equal(imageResult.mutations,3);
assert.equal(images.state.statementResources.length,0);
assert.equal(images.state.commit,1);
assert.equal(images.calls.filter(c=>c==='problem.deleteStatementResource').length,2);
assert(!images.calls.includes('problem.deleteFile'));
assert(!images.calls.includes('problem.saveStatement'));
assert(images.calls.indexOf('problem.deleteStatementResource')<
       images.calls.indexOf('problem.commitChanges'));
console.log('PASS: overwrite clears stale statement images without altering ordinary files');

const beforeRetry=images.calls.length;
const imageRetry=await executeImport({job,api:images.api});
assertNoDataWrites(imageRetry,images.calls.slice(beforeRetry));
assert.equal(imageRetry.committed,true);
assert(!images.calls.slice(beforeRetry).includes('problem.deleteStatementResource'));
console.log('PASS: another overwrite does not re-delete statement images');

// Partial failures leave the surviving resources for the next re-read.
const interrupted=await buildMock();
interrupted.state.statementResources=[{name:'first.png'},{name:'second.jpg'}];
interrupted.state.failDeletionName='second.jpg';
await assert.rejects(()=>executeImport({job,api:interrupted.api}),
  /simulated statement resource deletion failure/);
assert.deepEqual(interrupted.state.statementResources.map(f=>f.name),['second.jpg']);
assert.equal(interrupted.state.commit,0);
interrupted.state.failDeletionName=null;
const resumed=await executeImport({job,api:interrupted.api});
assert.equal(resumed.mutations,2);
assert.equal(resumed.committed,true);
assert.deepEqual(interrupted.state.statementResources,[]);
console.log('PASS: failed image cleanup resumes using Polygon remote state');

// A malformed response must block destructive changes before any writes.
const unreadable=await buildMock();
unreadable.state.statementResources=null;
await assert.rejects(()=>executeImport({job,api:unreadable.api}),
  /지문 첨부 리소스를 포함한 정보를 완전히 읽지/);
assert(!unreadable.calls.some(c=>/^problem\.(?:save|delete|updateInfo|commitChanges)/.test(c)));
console.log('PASS: unreadable statement resources fail closed before mutations');


const changedStatement=await buildMock();
changedStatement.state.statements.english.legend='old legend';
changedStatement.state.statementResources=[{name:'old-illustration.png'}];
await executeImport({job,api:changedStatement.api});
assert(changedStatement.calls.indexOf('problem.saveStatement')>=0);
assert(changedStatement.calls.indexOf('problem.saveStatement')<
       changedStatement.calls.indexOf('problem.deleteStatementResource'));
console.log('PASS: old images are deleted after replacement statement is saved');

const created=await buildMock();
let createdId = null;
const newProblem=await executeImport({
  job:{...job,mode:'create',problemId:null},api:created.api,
  onCreated:id=>{
    createdId=id;
    assert.equal(created.calls.at(-1),'problem.create',
      'save the created ID before sending any mutation');
  }
});
assert.equal(newProblem.id,42);
assert.equal(createdId,42);
assert(!created.calls.includes('problem.statementResources'));
assert(!created.calls.includes('problem.deleteStatementResource'));
console.log('PASS: creating a fresh problem never queries or deletes old images');

const failedSave=await buildMock();
let knownId=null;
await assert.rejects(()=>executeImport({
  job:{...job,mode:'create',problemId:null},api:failedSave.api,
  onCreated:id=>{knownId=id;throw Error('failed to store created ID');}
}),error=>{
  assert.match(error.message,/failed to store created ID/);
  assert.equal(error.problemId,42);
  assert.equal(error.partial,true);
  return true;
});
assert.equal(knownId,42);
assert(!failedSave.calls.some(s=>s.startsWith('problem.save') || s==='problem.updateInfo'));
console.log('PASS: created ID is persisted before any upload and surfaced on failure');
