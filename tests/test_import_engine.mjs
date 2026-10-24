// Integration test of the new importer engine using a mock Polygon API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadPolygonPackage } from '../model.js';
import { ZipArchive } from '../zip.js';
import { executeImport } from '../polygon-import.js';

const [zipPath, treePath] = process.argv.slice(2);
const parsed=JSON.parse(await fs.readFile(treePath,'utf8'));

class FakeNode {
  constructor(data) {
    this.localName=data.tag;
    this.attrs=data.attributes;
    this.children=data.children.map(c=>new FakeNode(c));
    this.textContent=data.text+this.children.map(c=>c.textContent).join('');
  }
  getAttribute(key){return Object.hasOwn(this.attrs,key)?this.attrs[key]:null;}
  hasAttribute(key){return Object.hasOwn(this.attrs,key);}
}
globalThis.DOMParser=class {
  parseFromString(){return {querySelector:()=>null,documentElement:new FakeNode(parsed)};}
};

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
    files[key].push({name:f.name,length:new TextEncoder().encode(body).length});
  }
  const sols=[];
  for(const solution of plan.solutions){
    const body=await archive.text(solution.path);
    solutions.set(solution.name,body);
    sols.push({name:solution.name,length:new TextEncoder().encode(body).length,tag:solution.tag});
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
        case 'stresses':return [];
        case 'files':return clone(state.files);
        case 'solutions':return clone(state.solutions);
        case 'statements':return clone(state.statements);
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
        case 'saveFile':source.set(args.type+':'+args.name,args.file);return {};
        case 'saveSolution':solutions.set(args.name,args.file);return {};
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
assert.equal(result.mutations,0);
assert.equal(result.committed,false);
assert.equal(a.state.commit,0);
assert.equal(logs.at(-1).progress,100);
assert(!a.calls.some(s=>/save|delete|updateInfo|commitChanges/.test(s)));
console.log('PASS: existing identical Polygon problem is not modified');

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
