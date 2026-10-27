import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import {createPolygon} from './helpers/polygon.mjs';
import {readTarget} from '../src/polygon/target.js';
import {syncPackage} from '../src/polygon/sync.js';
let seed=0x526bcf;const initialSeed=seed;
const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
const task=(_,fn)=>fn();
function plan(salt){
 const count=1+rand(10),g=rand(Math.min(4,count)+1),scored=!!rand(2),interactive=!!rand(2),twice=!!rand(2);
 const groups=Array.from({length:g},(_,i)=>({name:'g'+i,pointsPolicy:rand(2)?'COMPLETE_GROUP':'EACH_TEST',
  feedbackPolicy:['NONE','POINTS','ICPC','COMPLETE'][rand(4)],dependencies:Array.from({length:i},(_,j)=>'g'+j).filter(()=>rand(3)===0)}));
 const tests=Array.from({length:count},(_,i)=>({index:i+1,method:rand(2)?'manual':'generated',path:'input/'+(i+1),cmd:'gen '+(i+1)+' '+salt,
  group:i<g?'g'+i:g&&rand(3)?'g'+rand(g):'',points:scored?rand(101):null,description:'case '+salt,sample:false}));
 const p={info:{timeLimit:1000,memoryLimit:256,inputFile:'stdin',outputFile:'stdout',interactive,runTwice:twice,
  ...(interactive?{interactiveSecondRun:twice&&!!rand(2),useInteractionLogInExampleTests:false}:{})},
  statements:[],sources:[{name:'gen.cpp',path:'gen.cpp'},{name:'val.cpp',path:'val.cpp'},...(interactive?[{name:'int.cpp',path:'int.cpp'}]:[])],resources:[],aux:[],
  solutions:[{name:'main.cpp',path:'main.cpp',tag:'MA'}],checker:'std::wcmp',validator:'val.cpp',interactor:interactive?'int.cpp':'',tests,groups,validatorTests:[],checkerTests:[],tags:[]};
 return p;
}
const cases=Number(process.env.POLYGON_RANDOM_CASES || 200);
assert(Number.isSafeInteger(cases) && cases>=1 && cases<=10000);
const failures=[];let transitions=0,noops=0;
for(let iteration=0;iteration<cases;iteration++){
 const mock=createPolygon();
 const original=plan(iteration*2),next=plan(iteration*2+1);
 const archive={text:async path=>path.startsWith('input/')?path.split('/')[1]+'\n':'int main(){return 0;}'};
 try{
  await syncPackage({api:mock.api,id:42,plan:original,archive,read:task,write:task});
  if(iteration%3===0)mock.state.groupsEnabled=false;
  if(iteration%5===0)mock.state.pointsEnabled=false;
  const apply=async p=>syncPackage({api:mock.api,id:42,plan:p,archive,target:await readTarget(mock.api,42,p),read:task,write:task});
  await apply(next);transitions++;
  for(const t of next.tests){const r=mock.state.tests.get(t.index);assert(r);assert.equal(r.manual,t.method==='manual');
    if(next.groups.length)assert.equal(r.group||'',t.group);if(t.points!=null)assert.equal(r.points,t.points);}
  for(const g of next.groups)assert.deepEqual(mock.state.groups.get(g.name),g);
  assert.equal(mock.state.info.interactive,next.info.interactive);assert.equal(mock.state.info.runTwice,next.info.runTwice);
  const same=await apply(next);assert.equal(same.mutations,0);noops++;
 }catch(e){failures.push({iteration,error:e.message,original,next});}
}
const result={seed:initialSeed,cases,transitionsPassed:transitions,noopsPassed:noops,failures};
console.log('RANDOM_FORMAT_REGRESSION',JSON.stringify({...result,failures:failures.map(f=>({iteration:f.iteration,error:f.error}))}));
if(failures.length)process.exitCode=1;
