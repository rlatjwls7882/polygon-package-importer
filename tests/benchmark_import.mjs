// Offline request/decompression counts, not a measurement of Polygon server latency.
// Usage: node tests/benchmark_import.mjs /path/to/baseline-checkout
import './helpers/i18n.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createPolygon } from './helpers/polygon.mjs';
import { makeZip } from './helpers/zip.mjs';

if(!process.argv[2])throw Error('Pass a baseline checkout directory.');
const current=new URL('../',import.meta.url);
const baseline=pathToFileURL(resolve(process.argv[2])+'/');
const makePlan=()=>({info:{timeLimit:1000,memoryLimit:256,inputFile:'stdin',outputFile:'stdout',interactive:false,runTwice:false},
  statements:[],sources:[],resources:[],aux:[],solutions:[],checker:'',validator:'',interactor:'',tests:[],groups:[],validatorTests:[],checkerTests:[],tags:[]});
const task=(_,fn)=>fn();
const results={};
for(const [version,root] of [['baseline',baseline],['updated',current]]) {
  const {ZipArchive}=await import(new URL('src/package/zip.js',root));
  const {syncPackage}=await import(new URL('src/polygon/sync.js',root));
  const {readTarget}=await import(new URL('src/polygon/target.js',root));
  const files={'problem.xml':'<problem/>'};
  for(let i=0;i<256;i++)files['file-'+i+'.txt']=('entry '+i+' data 12345\n').repeat(512);
  const zip=makeZip(files),native=globalThis.DecompressionStream;
  let inflations=0;
  globalThis.DecompressionStream=class {constructor(format){inflations++;return new native(format);}};
  const start=performance.now();
  try {
    const archive=new ZipArchive(zip);
    for(let pass=0;pass<4;pass++)for(let i=0;i<256;i++)assert.equal(await archive.text('file-'+i+'.txt'),files['file-'+i+'.txt']);
  } finally {globalThis.DecompressionStream=native;}
  const zipMs=performance.now()-start;
  const mock=createPolygon(),plan=makePlan(),contents={};
  for(let i=0;i<64;i++) {
    const name='source-'+i+'.cpp',body=('// file '+i+'\nint value = 42;\n').repeat(512);
    plan.sources.push({name,path:name});contents[name]=body;
    mock.state.files.source.set(name,body.replace(/\n/g,'\r\n'));
  }
  const target=await readTarget(mock.api,42,plan);
  const fileResult=await syncPackage({api:mock.api,id:42,plan,target,archive:{text:async name=>contents[name]},read:task,write:task});
  const sourceBytes=mock.calls.reduce((sum,call)=>sum+Buffer.byteLength(call.args?.file||''),0);
  const groupMock=createPolygon(),groupPlan=makePlan();
  groupMock.state.groupsEnabled=true;groupMock.state.pointsEnabled=true;
  for(let i=1;i<=10;i++) {
    const group={name:'g'+i,pointsPolicy:'COMPLETE_GROUP',feedbackPolicy:'COMPLETE',dependencies:i>1?['g'+(i-1)]:[]};
    groupPlan.groups.push(group);groupMock.state.groups.set(group.name,structuredClone(group));
    groupPlan.tests.push({index:i,method:'manual',path:'test'+i,group:group.name,points:10,sample:false,description:''});
    groupMock.state.tests.set(i,{index:i,manual:true,input:'1\n',inputBase64:Buffer.from('1\n').toString('base64'),group:group.name,points:10,useInStatements:false,description:''});
  }
  const groupTarget=await readTarget(groupMock.api,42,groupPlan);
  const groupResult=await syncPackage({api:groupMock.api,id:42,plan:groupPlan,target:groupTarget,archive:{text:async()=>'1\n'},read:task,write:task});
  assert.equal(groupResult.mutations,0);
  const generatedMock=createPolygon(),generatedPlan=makePlan();
  for(let i=1;i<=128;i++) {
    generatedPlan.tests.push({index:i,method:'generated'});
    generatedMock.state.tests.set(i,{index:i,manual:true,input:'1'.repeat(8192),inputBase64:Buffer.from('1'.repeat(8192)).toString('base64')});
  }
  const snapshot=await readTarget(generatedMock.api,42,generatedPlan);
  const groupBatchScenarios = [];
  for (const [groupCount, otherEdits] of [[1,0],[5,0],[1,20]]) {
    const mock = createPolygon(), plan = makePlan();
    mock.state.groupsEnabled = true;
    mock.state.groups.set('old',{name:'old',pointsPolicy:'COMPLETE_GROUP',feedbackPolicy:'COMPLETE',dependencies:[]});
    plan.groups = Array.from({length:groupCount},(_,i)=>({name:'g'+i,pointsPolicy:'COMPLETE_GROUP',feedbackPolicy:'COMPLETE',dependencies:[]}));
    for (let index=1;index<=100;index++) {
      const manual = index%2===1;
      plan.tests.push({index,method:manual?'manual':'generated',path:String(index),cmd:'gen '+index,
        group:plan.groups[(index-1)%groupCount].name,points:null,sample:false,description:index<=otherEdits?'updated':''});
      mock.state.tests.set(index,{index,manual,group:'old',description:'',useInStatements:false,
        ...(manual?{input:index+'\n',inputBase64:Buffer.from(index+'\n').toString('base64')}:{scriptLine:'gen '+index+' > '+index})});
    }
    mock.state.script=plan.tests.filter(test=>test.method==='generated').map(test=>test.cmd+' > '+test.index).join('\n');
    const target=await readTarget(mock.api,42,plan);
    const result=await syncPackage({api:mock.api,id:42,plan,target,archive:{text:async path=>path+'\n'},read:task,write:task});
    for (const desired of plan.tests) {
      assert.equal(mock.state.tests.get(desired.index).group,desired.group);
      assert.equal(mock.state.tests.get(desired.index).description,desired.description);
    }
    groupBatchScenarios.push({tests:100,groupCount,otherEdits,testWrites:result.testMutations,
      saveTest:mock.calls.filter(call=>call.method==='saveTest').length,
      setTestGroup:mock.calls.filter(call=>call.method==='setTestGroup').length,totalRequests:mock.calls.length});
  }
  results[version]={zipFiles:256,zipPasses:4,inflations,zipMs:Number(zipMs.toFixed(1)),
    eolFileMutations:fileResult.mutations,eolRequests:mock.calls.length,eolSourceBytesUploaded:sourceBytes,
    noOpGroupQueries:groupMock.calls.filter(call=>call.method==='viewTestGroup').length,
    generatedReplacementInputBytes:Buffer.byteLength(JSON.stringify(snapshot.tests)),groupBatchScenarios};
}
console.log(JSON.stringify(results,null,2));
