// Stateful offline request counts. No request reaches Polygon and no problem source is executed.
// node tests/benchmark_package_snapshot.mjs /path/to/baseline [optional-real-package.zip]
import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './helpers/format-fixture.mjs';
import {createPolygon} from './helpers/polygon.mjs';
import {attachBuild} from './helpers/build.mjs';
import {installNativeTestParser} from './helpers/native-xml.mjs';
if(!process.argv[2])throw Error('Pass a baseline checkout');
const scenarios=[['ordinary',fixture({groups:false}).file],
  ['interactive-twice-subtasks',fixture({interactive:true,twice:true,extraTags:true,grader:true}).file]];
if(process.argv[3])scenarios.push(['real-package',new Blob([await fs.readFile(process.argv[3])])]);
const report={kind:'offline request counts; excludes build verification',versions:{}};
for(const [label,root] of [['baseline',pathToFileURL(resolve(process.argv[2])+'/')],['updated',new URL('../',import.meta.url)]]){
 const {executeImport}=await import(new URL('src/polygon/import.js',root));
 const results=[];
 for(const [name,file] of scenarios){
  const mock=createPolygon(),build=attachBuild(mock);
  const run=mode=>executeImport({api:mock.api,job:{file,mode,problemId:42,commit:true,verify:mode==='create'},
    verificationOptions:{maxPolls:2,pollMs:0,sleep:async()=>{}}});
  installNativeTestParser();await run('create');mock.calls.length=0;
  const result=await run('replace');
  const methods=Object.fromEntries([...new Set(mock.calls.map(call=>call.method))].map(method=>[method,mock.calls.filter(call=>call.method===method).length]));
  results.push({name,requests:mock.calls.length,mutations:result.mutations,methods});
  if(label==='updated'){assert.equal(result.mutations,0);assert.equal(build.builds,1);}
 }
 report.versions[label]=results;
}
console.log(JSON.stringify(report,null,2));
