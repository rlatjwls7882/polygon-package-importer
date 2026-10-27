import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { syncPackage } from '../src/polygon/sync.js';
import { configureScoring, syncGroups } from '../src/polygon/groups.js';

const plan = {
  info:{timeLimit:1000,memoryLimit:256,inputFile:'stdin',outputFile:'stdout',interactive:true},
  statements:[], sources:[{name:'interactor.cpp',path:'files/interactor.cpp'}],
  resources:[], aux:[], solutions:[], checker:'std::wcmp', validator:'', interactor:'interactor.cpp',
  tests:[], groups:[], validatorTests:[], checkerTests:[], tags:[]
};
const calls = [];
const api = {problem:async (method,id,args) => {calls.push({method,id,args}); return {};}};
const run = (_, task) => task();
await syncPackage({api,id:42,plan,archive:{text:async () => 'int main(){}'},read:run,write:run});
const methods = calls.map(call => call.method);
assert(methods.indexOf('saveFile') < methods.indexOf('setInteractor'));
assert.equal(calls.find(call => call.method === 'setInteractor').args.interactor,'interactor.cpp');
assert.equal(calls.find(call => call.method === 'updateInfo').args.interactive,'true');
console.log('PASS: judge settings are synchronized after uploading their source files');

const groups = [
  {name:'large',dependencies:['small'],pointsPolicy:'COMPLETE_GROUP',feedbackPolicy:'COMPLETE'},
  {name:'small',dependencies:[],pointsPolicy:'COMPLETE_GROUP',feedbackPolicy:'COMPLETE'}
];
const groupCalls = [], skipped = [];
let existing = [];
const context = {
  api:{problem:async (method,id,args) => {
    if (method === 'viewTestGroup') return existing;
    groupCalls.push({method,id,args});
    return {};
  }}, id:42,
  plan:{groups,tests:[{group:'small',points:30},{group:'large',points:70}]},
  target:null, read:run, apply:run, unchanged:label => skipped.push(label)
};
await configureScoring(context);
await syncGroups(context);
assert.deepEqual(groupCalls.map(call => call.method), ['enableGroups','enablePoints','saveTestGroup','saveTestGroup']);
assert.equal(groupCalls[2].args.dependencies,'small');
assert.equal(groupCalls[3].args.dependencies,'');
assert(groupCalls.filter(call => call.method !== 'enablePoints').every(call => call.args.testset === 'tests'));
existing = structuredClone(groups);
context.target = {tests:[{group:'small',points:30},{group:'large',points:70}]};
groupCalls.length = 0;
await configureScoring(context);
await syncGroups(context);
assert.equal(groupCalls.length,0);
assert.equal(skipped.length,2);
console.log('PASS: scoring and explicit group dependencies survive synchronization; unchanged groups are skipped');

context.plan = {groups:[],tests:[{group:'',points:null}]};
await configureScoring(context);
assert.deepEqual(groupCalls.map(call => [call.method, call.args.enable]), [['enableGroups','false'],['enablePoints','false']]);
console.log('PASS: replacing scored groups with an ordinary testset disables group and point modes');
