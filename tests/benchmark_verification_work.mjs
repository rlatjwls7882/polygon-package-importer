// Offline counts only. Pass a baseline checkout; no request reaches Polygon.
import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fixture } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { attachBuild } from './helpers/build.mjs';
import { installNativeTestParser } from './helpers/native-xml.mjs';
if(!process.argv[2])throw Error('Pass a baseline checkout directory');
const report={kind:'synthetic request and serialized-checkpoint counts',node:process.version};
for(const [name,root] of [['baseline',pathToFileURL(resolve(process.argv[2])+'/')],['updated',new URL('../',import.meta.url)]]) {
  const {executeImport}=await import(new URL('src/polygon/import.js',root));
  const {validatePackage}=await import(new URL('src/package/validate.js',root));
  const metadata=new URL('src/polygon/file-metadata.js',root);
  const {verifyFileMetadata}=await import(existsSync(metadata)?metadata:new URL('src/polygon/files.js',root));
  async function run({history=0,staleReady=false,staleRunning=false}={}) {
    const f=fixture(),mock=createPolygon(),build=attachBuild(mock),saved=[];
    for(let i=0;i<history;i++)build.records.push({pkg:{id:1000+i,revision:1,state:'READY',comment:''},detail:{invocation:{id:10000+i}}});
    if(staleReady)build.afterBuild=()=>{mock.state.entry.revision++;mock.state.entry.workingCopyRevision++;};
    if(staleRunning)build.afterBuild=record=>{record.pkg.state='RUNNING';};
    installNativeTestParser();
    const operation=executeImport({api:mock.api,job:{file:f.file,mode:'create',commit:true,verify:true},
      onCheckpoint:async value=>saved.push(structuredClone(value)),
      verificationOptions:{maxPolls:36,pollMs:0,sleep:async()=>{if(staleRunning)mock.state.entry.modified=true;}}});
    if(staleReady||staleRunning)await assert.rejects(()=>operation);else await operation;
    return {mock,build,saved};
  }
  const history=await run({history:3000});
  const pinned=history.saved.find(checkpoint=>checkpoint.packageId!=null);
  const stale=await run({staleReady:true}),running=await run({staleRunning:true});
  const plan={info:{interactive:false},checker:'std::wcmp',checkerPercent:false,groups:[],sources:[],resources:[],aux:[],
    solutions:[{name:'main.cpp',path:'main.cpp',tag:'MA'}],
    tests:[{index:1,method:'manual',path:'shared',outputPath:'shared',sampleInputPath:'shared'}],
    validatorTests:[{index:1,inputPath:'shared'}],checkerTests:[{index:1,inputPath:'shared',outputPath:'shared',answerPath:'shared'}],unsupported:[]};
  let textReads=0;
  await validatePackage({names:()=>[],text:async path=>{if(path==='shared')textReads++;return 'text';}},plan);
  const metadataCalls=[];
  await verifyFileMetadata({id:42,plan:{sources:[],solutions:[],aux:[],resources:[{name:'data.txt',resourceAdvancedProperties:null}]},
    read:(_,task)=>task(),api:{problem:async method=>{
      metadataCalls.push(method);return method==='files'?{sourceFiles:[],resourceFiles:[{name:'data.txt'}],auxFiles:[]}:[];
    }}});
  report[name]={historicalPackages:3000,pinnedHistoryIds:pinned.beforeIds.length,
    pinnedCheckpointBytes:Buffer.byteLength(JSON.stringify(pinned)),sharedPathReferences:7,sharedPathReads:textReads,
    staleBuildZipDownloads:stale.mock.calls.filter(call=>call.method==='package').length,
    staleBuildDetailDownloads:stale.mock.calls.filter(call=>call.method==='invocation').length,
    obsoleteRunningBuildPolls:running.mock.calls.filter(call=>call.method==='packages').length-1,
    resourceOnlyMetadataQueries:metadataCalls};
}
console.log(JSON.stringify(report,null,2));
