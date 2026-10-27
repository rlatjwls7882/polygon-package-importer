import './mock-i18n.mjs';
// Polygon problem.deleteTest supports a comma-separated batch of indices.
import assert from 'node:assert/strict';
import {syncPackage} from '../sync.js';

function fixture({failDeletion = false} = {}) {
  const plan = {
    info:{timeLimit:1000,memoryLimit:256,inputFile:'stdin',outputFile:'stdout',interactive:false},
    statements:[], sources:[], resources:[], aux:[], solutions:[],
    checker:'',validator:'',interactor:'',groups:[],validatorTests:[],checkerTests:[],tags:[],
    tests:Array.from({length:3},(_,i)=>({
      index:i+1,method:'manual',path:String(i+1),sample:false,
      description:'',group:'',points:null
    }))
  };
  let tests = Array.from({length:5},(_,i)=>{
    const input=(i+1)+'\n';
    return {index:i+1,manual:true,description:'',useInStatements:false,
      inputBase64:Buffer.from(input).toString('base64')};
  });
  const calls=[];
  const api={
    async problem(method,id,args={}) {
      switch (method) {
        case 'info': return plan.info;
        case 'viewTags': return [];
        case 'tests': return tests.map(t=>({...t}));
        case 'deleteTest':
          calls.push({method,...args});
          assert.equal(args.testset,'tests');
          assert.equal(args.testIndices,'5,4');
          assert(!Object.hasOwn(args,'testIndex'));
          if(failDeletion) throw Error('Some tests can not be deleted.');
          tests=tests.filter(t=>![4,5].includes(t.index));
          return {};
        case 'saveTest': throw Error('Matching manual tests should not be re-uploaded');
        default: throw Error('Unexpected Polygon API call: '+method);
      }
    }
  };
  const snapshot=()=>({
    files:{sourceFiles:[],resourceFiles:[],auxFiles:[]},
    statements:{},statementResources:[],solutions:[],tests:tests.map(t=>({...t}))
  });
  const archive={async text(path){return path+'\n';}};
  const run=()=>syncPackage({api,id:42,plan,archive,target:snapshot(),
    read:(label,fn)=>fn(),write:(label,fn)=>fn()});
  return {run,calls,tests:()=>tests};
}

const a=fixture();
const result=await a.run();
assert.equal(result.mutations,1);
assert.equal(result.testMutations,1);
assert.equal(a.calls.length,1,'Two deletions must be sent as ONE API request');
assert.deepEqual(a.tests().map(t=>t.index),[1,2,3]);
assert.equal((await a.run()).mutations,0);
assert.equal(a.calls.length,1,'A second sync must not repeat deletion');
console.log('PASS: multiple obsolete manual tests are removed in one API request');

const b=fixture({failDeletion:true});
await assert.rejects(b.run(),/Some tests can not be deleted/);
assert.deepEqual(b.tests().map(t=>t.index),[1,2,3,4,5]);
assert.equal(b.calls.length,1);
console.log('PASS: failed batch deletion leaves local sync interrupted without further mutations');

console.log('PASS: all batch deletion regression tests');
