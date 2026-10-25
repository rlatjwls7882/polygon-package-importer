// Read-only test against a real Polygon package, with a fake API server.
// Simulates 28/50 manual tests already uploaded, HTTP loss mid-run, and resumes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ZipArchive } from '../zip.js';
import { loadPolygonPackage } from '../model.js';
import { syncPackage } from '../sync.js';

const [zipPath, treePath] = process.argv.slice(2);
const tree = JSON.parse(await fs.readFile(treePath,'utf8'));
class Node {
  constructor(v) {
    this.localName=v.tag;this.attrs=v.attributes;
    this.children=v.children.map(x=>new Node(x));
    this.textContent=v.text+this.children.map(x=>x.textContent).join('');
  }
  getAttribute(x){return Object.hasOwn(this.attrs,x)?this.attrs[x]:null;}
  hasAttribute(x){return Object.hasOwn(this.attrs,x);}
}
globalThis.DOMParser=class {parseFromString(){return {querySelector:()=>null,documentElement:new Node(tree)}}};
const buffer=await fs.readFile(zipPath);
const archive=new ZipArchive(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
const plan=await loadPolygonPackage(archive);
assert.equal(plan.tests.length,50);
assert(plan.tests.every(x=>x.method==='manual'));
const sourceContents=new Map();
const solutionContents=new Map();
const encoder=new TextEncoder();
const remoteFiles={sourceFiles:[],resourceFiles:[],auxFiles:[]};
for (const [type,key,list] of [
  ['source','sourceFiles',plan.sources],['resource','resourceFiles',plan.resources],['aux','auxFiles',plan.aux]
]) for(const file of list) {
  const contents=await archive.text(file.path);
  sourceContents.set(type+':'+file.name, contents);
  remoteFiles[key].push({name:file.name,length:encoder.encode(contents).length});
}
const remoteSolutions=[];
for(const file of plan.solutions) {
  const contents=await archive.text(file.path);
  solutionContents.set(file.name,contents);
  remoteSolutions.push({name:file.name,tag:file.tag,length:encoder.encode(contents).length});
}
const remoteTests=[];
async function remoteManual(test) {
  const input=await archive.text(test.path);
  const output=test.sample&&test.outputPath?await archive.text(test.outputPath):undefined;
  return {index:test.index,manual:true,inputBase64:Buffer.from(input,'utf8').toString('base64'),
    description:test.description||'',useInStatements:!!test.sample,
    ...(test.sample?{inputForStatement:input,outputForStatement:output}:{}),
    ...(test.group?{group:test.group}:{}),
    ...(test.points!==null?{points:test.points}:{})};
}
for(let index=0;index<28;index++)remoteTests.push(await remoteManual(plan.tests[index]));
const wanted=plan.tests.map(x=>x.index);
const calls=[], changes=[];
let failAt=32;
const api = {
  async problem(method,id,args={},opts={}) {
    calls.push(method);
    switch(method) {
      case 'info':return plan.info;
      case 'checker':return plan.checker;
      case 'validator':return plan.validator;
      case 'interactor':return plan.interactor;
      case 'viewTags':return plan.tags;
      case 'viewFile':return sourceContents.get(args.type+':'+args.name);
      case 'viewSolution':return solutionContents.get(args.name);
      case 'tests':return remoteTests.map(x=>({...x}));
      case 'saveTest':{
        const ix=Number(args.testIndex);
        if(ix===failAt){failAt=0;throw Error('network failed after accepted prior requests');}
        const target=plan.tests.find(t=>t.index===ix);
        const result=await remoteManual(target);
        const at=remoteTests.findIndex(x=>x.index===ix);
        if(at<0)remoteTests.push(result);
        else remoteTests[at]=result;
        return;
      }
      case 'viewTestGroup':return plan.groups;
      case 'saveTags':throw Error('Identical tags must not be sent');
      case 'updateInfo':throw Error('Identical info must not be sent');
      case 'saveStatement':throw Error('Identical statement must not be sent');
      case 'saveFile':throw Error('Identical file must not be reuploaded');
      case 'saveSolution':throw Error('Identical solution must not be reuploaded');
      case 'setChecker':case 'setValidator':case 'setInteractor':
        throw Error('Identical checker/validator settings must not be sent');
      case 'deleteFile':case 'deleteSolution':case 'deleteTest':
        throw Error('No remote items should be deleted');
      case 'enableGroups':case 'enablePoints':
        throw Error('No unused settings should be sent');
      default:throw Error('Unexpected API request: '+method);
    }
  }
};
function snapshot() {
  return {tests:remoteTests.map(x=>({...x})), files:remoteFiles,
    solutions:remoteSolutions,statements:Object.fromEntries(plan.statements.map(s=>[s.lang,s])),
    statementResources:[],
    resources:[],validatorTests:[],checkerTests:[],groups:[]};
}
async function run() {
  return syncPackage({api,id:42,plan,archive,target:snapshot(),
    read:async (label, fn)=>fn(),
    write:async (label, fn)=>{changes.push(label);return fn();},
    skip:()=>{}});
}
let error;
try{await run();}catch(e){error=e;}
assert(error?.message.includes('network failed'));
assert.equal(remoteTests.length,31, 'three missing tests before test 32 failure should be saved');
assert(changes.every(s=>s.startsWith('수동 테스트 ')));
assert.deepEqual(changes.map(s=>Number(s.match(/(\d+)\/50/)[1])),[29,30,31,32]);
console.log('PASS: partial synchronization saves only tests 29–31, stops at failure on test 32');
changes.length=0;
const result=await run();
assert.equal(result.testMutations,19);
assert.equal(result.mutations,19);
assert.equal(remoteTests.length,50);
assert.deepEqual(remoteTests.map(x=>x.index).sort((a,b)=>a-b),wanted);
assert(!calls.includes('deleteTest'));
console.log('PASS: resume after failure saves only tests 32–50, leaves 1–31 unchanged');
changes.length=0;
const requestsBefore=calls.length;
const noops=await run();
assert.equal(noops.mutations,0);
assert.equal(changes.length,0);
assert(!calls.slice(requestsBefore).some(x=>x.startsWith('save')||x.startsWith('delete')||x.startsWith('update')));
console.log('PASS: fully synchronized repeat sends ZERO mutation requests');
