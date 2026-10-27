import { makeZip } from './zip.mjs';
import { installNativeTestParser } from './native-xml.mjs';
import { ZipArchive } from '../../src/package/zip.js';
import { loadPolygonPackage } from '../../src/package/load.js';
import { executeImport } from '../../src/polygon/import.js';

export const n=(tag,attributes={},children=[],text='')=>({tag,attributes,children,text});
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export const xml=node=>'<'+node.tag+Object.entries(node.attributes).map(([k,v])=>' '+k+'="'+escape(v)+'"').join('')+'>'+escape(node.text)+node.children.map(xml).join('')+'</'+node.tag+'>';
export function fixture({interactive=false,twice=false,padded=false,percent,grader=false,extraTags=false,
    secondValidator=false,selfTests=false,noMain=false,groups=true,generated=false,omitSamples=false,mutate}={}) {
  const contents={
    'statement-sections/english/name.tex':'Audit fixture',
    'statement-sections/english/legend.tex':'Read the problem.',
    'statement-sections/english/input.tex':'Input',
    'statement-sections/english/output.tex':'Output',
    'files/val.cpp':'int main(){return 0;}',
    'files/second.cpp':'int main(){return 0;}',
    'files/interactor.cpp':'int main(){return 0;}',
    'files/gen.cpp':'int main(){return 0;}',
    'files/grader.cpp':'extern int solve(); int main(){return solve();}',
    'solutions/main.cpp':grader?'int solve(){return 0;}':'#include <bit>\nint main(){return std::popcount(3u)-2;}',
    'solutions/partial.cpp':'int main(){return 1;}',
    'tests/01':'1\n','tests/01.a':'3\n','tests/02':'2\n','tests/02.a':'4\n',
    'validator/01':'1\n'
  };
  if(!omitSamples){
    const index=padded?'01':'1',pre='statement-sections/english/example.'+index;
    contents[pre]='PUBLIC SAMPLE\n';contents[pre+'.a']='PUBLIC OUTPUT\n';
    if(interactive)contents[pre+'.mu']='? PUBLIC QUESTION\n! PUBLIC ANSWER\n';
  }
  const src=path=>n('source',{path,type:'cpp.g++20'});
  const validator=n('validator',{},[src('files/val.cpp')]);
  if(selfTests)validator.children.push(n('testset',{},[
    n('input-path-pattern',{},[],'validator/%02d'),n('tests',{},[n('test',{verdict:'valid',group:'A',testset:'tests'})])
  ]));
  const solutions=[n('solution',{tag:noMain?'accepted':'main'},[src('solutions/main.cpp')])];
  if(extraTags)solutions.push(n('solution',{tag:'wrong-answer'},[src('solutions/partial.cpp'),
    n('extra-tags',{},[n('extra-tag',{group:'A',tag:'accepted'})])]));
  const assets=[n('checker',{name:'std::wcmp'}),n('validators',{},[validator,...(secondValidator?[n('validator',{},[src('files/second.cpp')])]:[])]),n('solutions',{},solutions)];
  if(interactive)assets.push(n('interactor',{},[src('files/interactor.cpp'),n('runs',{},[n('run',{},[],'1'),...(twice?[n('run',{},[],'2')]:[])])]));
  const tests=[1,2].map(index=>n('test',{method:generated?'generated':'manual',sample:index===1?'true':'false',
    ...(generated?{cmd:'gen '+index}:{}),...(groups?{group:'A',points:'50'}:{})}));
  const ts=n('testset',{name:'tests'},[n('time-limit',{},[],'1000'),n('memory-limit',{},[],'268435456'),
    n('test-count',{},[],'2'),n('input-path-pattern',{},[],'tests/%02d'),n('answer-path-pattern',{},[],'tests/%02d.a'),
    n('tests',{},tests),...(groups?[n('groups',{},[n('group',{name:'A',points:'100', 'feedback-policy':'complete','points-policy':'complete-group'})])]:[])]);
  const root=n('problem',{'short-name':'audit-fixture'},[
    n('statements',{},[n('statement',{language:'english',charset:'UTF-8'})]),
    n('files',{},[n('executables',{},generated?[n('executable',{},[src('files/gen.cpp')])]:[]),n('resources',{},grader?[
      n('file',{path:'files/grader.cpp','for-types':'cpp.*'},[n('stages',{},[n('stage',{name:'compile'})]),n('assets',{},[n('asset',{name:'solution'})])])]:[])]),
    n('assets',{},assets),n('judging',{'run-count':twice?'2':'1',...(percent===undefined?{}:{'treat-points-from-checker-as-percent':String(percent)})},[ts])
  ]);
  if(generated && omitSamples){delete contents['tests/01'];delete contents['tests/01.a'];delete contents['tests/02'];delete contents['tests/02.a'];}
  mutate?.({root,contents,assets,ts,tests,validator,solutions});
  contents['problem.xml']=xml(root);
  const buffer=makeZip(contents),file={name:'audit.zip',size:buffer.byteLength,arrayBuffer:async()=>buffer.slice(0)};
  return {root,contents,file,async parse(){installNativeTestParser();return loadPolygonPackage(await ZipArchive.fromFile(file));},
    async upload(mock,mode='create'){installNativeTestParser();return executeImport({job:{file,mode,problemId:mode==='replace'?'42':null,commit:true},api:mock.api});}};
}
