import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInvocation } from '../src/polygon/verification/invocation.js';
function fixture(solutions=40,tests=200){
 const plan={solutions:Array.from({length:solutions},(_,i)=>({name:'sol'+i+'.cpp',tag:i?'OK':'MA'})),tests:Array.from({length:tests},(_,i)=>({index:i*2+1}))};
 const detail={invocation:{id:9,packageId:7,testset:'tests',status:'FINISHED',violateTag:false,solutions:plan.solutions.map(s=>s.name),tests:plan.tests.map(t=>t.index)},
 solutionTags:plan.solutions.map(s=>({...s,testsetTags:{},groupTags:{}})),runs:plan.solutions.flatMap(s=>plan.tests.map(t=>({solution:s.name,test:t.index,verdict:'OK',violateTag:false})))};
 return {plan,detail,pkg:{id:7}};
}
test('verification does not allocate a JSON-string identity for every solution/test pair',()=>{
 const {plan,detail,pkg}=fixture(),stringify=JSON.stringify;let calls=0;
 JSON.stringify=(...args)=>{calls++;return stringify(...args);};
 try {assert.equal(checkInvocation(detail,pkg,plan).runs,8000);assert(calls<=100,'Per-run identity serialization: '+calls);}
 finally {JSON.stringify=stringify;}
});
test('a pending run cannot hide a later failure in an otherwise finished invocation',()=>{
 const {plan,detail,pkg}=fixture(2,2);detail.runs[0].verdict='TS';detail.runs[1].verdict='CE';
 assert.throws(()=>checkInvocation(detail,pkg,plan));
});

for (const [title,change] of [
  ['duplicate pairs',d=>{d.runs[1]=d.runs[0];}],
  ['unknown tests',d=>{d.runs[0].test=2;}],
  ['unknown solutions',d=>{d.runs[0].solution='unknown.cpp';}],
  ['a late malformed verdict behind a pending run',d=>{d.runs[0].verdict='TS';d.runs[1].verdict='UNKNOWN';}]
]) test('compact coverage still rejects '+title,()=>{
 const {plan,detail,pkg}=fixture(3,5);change(detail);assert.throws(()=>checkInvocation(detail,pkg,plan));
});
test('compact coverage handles sparse indices, out-of-order runs, partial final bytes and missing pairs',()=>{
 const {plan,detail,pkg}=fixture(3,5);detail.runs.reverse();assert.equal(checkInvocation(detail,pkg,plan).runs,15);
 const missing=detail.runs.pop();assert.equal(checkInvocation(detail,pkg,plan),null);
 detail.runs.push(missing);detail.runs[2].verdict='NO';assert.equal(checkInvocation(detail,pkg,plan),null);
});
