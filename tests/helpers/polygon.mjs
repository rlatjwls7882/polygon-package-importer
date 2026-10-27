import assert from 'node:assert/strict';

const copy = value => structuredClone(value);
const flag = value => value === true || value === 'true';
const writes = /^(?:save|set|delete|clear|enable|edit|updateInfo|commitChanges)/;

// Stateful API double: reject invalid request ordering instead of accepting all writes.
export function createPolygon() {
  const state = {
    info:{timeLimit:1000,memoryLimit:256,inputFile:'stdin',outputFile:'stdout',interactive:false,wellFormed:false,
      runTwice:false,interactiveSecondRun:false,useInteractionLogInExampleTests:false},
    entry:{id:42,revision:1,workingCopyRevision:1,modified:false,deleted:false,accessType:'OWNER',name:'test'},
    fileMetadata:{source:new Map(),resource:new Map(),aux:new Map()},
    solutionExtraTags:new Map(), checkerPercent:false, extraValidators:[],
    files:{source:new Map(),resource:new Map(),aux:new Map()}, solutions:new Map(), statements:{},
    tests:new Map(), groups:new Map(), groupsEnabled:false, pointsEnabled:false,
    checker:'', validator:'', interactor:'', tags:[], script:'', statementResources:[],
    validatorTests:[], checkerTests:[], commits:0, creates:0,
    ignoreRunTwice:false, ignorePoints:false, fail:null
  };
  const calls = [];
  function ensureGroup(name) {
    if (name && !state.groups.has(name)) state.groups.set(name,
      {name,pointsPolicy:'COMPLETE_GROUP',feedbackPolicy:'COMPLETE',dependencies:[]});
  }
  function pruneGroups() {
    const used = new Set([...state.tests.values()].map(test => test.group).filter(Boolean));
    for (const name of state.groups.keys()) if (!used.has(name)) {
      assert(![...state.groups.values()].some(group => group.dependencies.includes(name)),
        'clear dependencies before deleting the last test in group ' + name);
      state.groups.delete(name);
    }
  }
  function acyclic() {
    const active = new Set(), done = new Set();
    function visit(name) {
      assert(state.groups.has(name),'Unknown dependency: '+name);
      assert(!active.has(name),'Transient dependency cycle: '+name);
      if (done.has(name)) return;
      active.add(name);
      for (const dependency of state.groups.get(name).dependencies) visit(dependency);
      active.delete(name); done.add(name);
    }
    for (const name of state.groups.keys()) visit(name);
  }
  function listedTests(noInputs) {
    return [...state.tests.values()].sort((a,b)=>a.index-b.index).map(test => {
      const result=copy(test);
      if (noInputs === 'true') {delete result.input;delete result.inputBase64;}
      if (!state.groupsEnabled) delete result.group;
      if (!state.pointsEnabled) delete result.points;
      return result;
    });
  }
  function apply(method, args) {
    switch (method) {
      case 'info': {
        const info=copy(state.info);
        if (!info.interactive) {delete info.interactiveSecondRun;delete info.useInteractionLogInExampleTests;}
        return info;
      }
      case 'updateInfo':
        for (const key of ['interactiveSecondRun','useInteractionLogInExampleTests'])
          if (key in args) assert(state.info.interactive,'Conditional option before interactive mode');
        for (const [key,value] of Object.entries(args)) {
          if (key==='runTwice' && state.ignoreRunTwice) continue;
          state.info[key] = ['interactive','runTwice','interactiveSecondRun','useInteractionLogInExampleTests','wellFormed'].includes(key)
            ? flag(value) : value;
        }
        return {};
      case 'files': return Object.fromEntries(Object.entries(state.files).map(([type,files]) => [
        type==='source'?'sourceFiles':type==='resource'?'resourceFiles':'auxFiles',
        [...files].map(([name,body])=>({name,length:Buffer.byteLength(body),...copy(state.fileMetadata[type].get(name)||{})}))
      ]));
      case 'saveFile': {
        if ('file' in args) state.files[args.type].set(args.name,args.file);
        else assert(state.files[args.type].has(args.name),'New files require content');
        const metadata=state.fileMetadata[args.type].get(args.name)||{};
        if ('sourceType' in args) metadata.sourceType=args.sourceType;
        if ('forTypes' in args) {
          assert.equal(args.type,'resource');
          if (!args.forTypes) delete metadata.resourceAdvancedProperties;
          else {
            assert.equal(args.stages,'COMPILE');assert.equal(args.assets,'SOLUTION');
            metadata.resourceAdvancedProperties={forTypes:args.forTypes,stages:args.stages.split(';'),assets:args.assets.split(';'),main:false};
          }
        }
        state.fileMetadata[args.type].set(args.name,metadata);return {};
      }
      case 'viewFile': return state.files[args.type].get(args.name);
      case 'deleteFile':
        if (args.type==='source') assert(![...state.tests.values()].some(test =>
          !test.manual && test.scriptLine?.split(/\s+/)[0]===args.name.replace(/\.[^.]+$/,'')),
          'Cannot delete a generator still used by the script');
        state.files[args.type].delete(args.name);return {};
      case 'extraValidators':return copy(state.extraValidators);
      case 'solutions': return [...state.solutions.values()].map(({file,...value})=>({...copy(value),length:Buffer.byteLength(file)}));
      case 'saveSolution': {
        const previous=state.solutions.get(args.name)||{};
        if (args.tag==='MA') assert(![...state.solutions.values()].some(solution=>solution.tag==='MA' && solution.name!==args.name));
        state.solutions.set(args.name,{...previous,...args});return {};
      }
      case 'editSolutionExtraTags': {
        assert(state.solutions.has(args.name));
        assert.equal(Boolean(args.testset)===Boolean(args.testGroup),false);
        if (args.testset) assert.equal(args.testset,'tests');
        if (args.testGroup) assert(state.groups.has(args.testGroup),'Create groups before setting their tags');
        const key=args.testGroup?'testGroup':'testset';
        const previous=state.solutionExtraTags.get(args.name)||[];
        const next=previous.filter(tag=>tag[key]!==args[key]);
        if (args.remove==='false') next.push({[key]:args[key],tag:args.tag});
        else assert.equal(args.remove,'true');
        state.solutionExtraTags.set(args.name,next);return {};
      }
      case 'viewSolution': return state.solutions.get(args.name)?.file;
      case 'deleteSolution': state.solutions.delete(args.name);return {};
      case 'statements': return copy(state.statements);
      case 'saveStatement':
        if (args.interaction) assert(state.info.interactive,'Interaction section on a non-interactive problem');
        state.statements[args.lang]={...state.statements[args.lang],...args};return {};
      case 'deleteStatement': delete state.statements[args.lang];return {};
      case 'statementResources': return copy(state.statementResources);
      case 'deleteStatementResource': state.statementResources=state.statementResources.filter(file=>file.name!==args.name);return {};
      case 'checker':case 'validator':case 'interactor':return state[method];
      case 'setChecker':case 'setValidator':case 'setInteractor': {
        const key=method.slice(3).toLowerCase(), name=args[key];
        assert(name.startsWith('std::') || state.files.source.has(name),'Judge source must be uploaded before selection');
        state[key]=name;return {};
      }
      case 'enableGroups': state.groupsEnabled=flag(args.enable);return {};
      case 'enablePoints': state.pointsEnabled=flag(args.enable);return {};
      case 'enableTreatPointsFromCheckerAsPercent':
        if(flag(args.enable))assert(state.pointsEnabled);
        state.checkerPercent=flag(args.enable);return {};
      case 'tests': return listedTests(args.noInputs);
      case 'script': return state.script;
      case 'clearScript':
        state.script='';
        for (const [index,test] of state.tests) if (!test.manual) state.tests.delete(index);
        pruneGroups();return {};
      case 'saveScript': {
        for (const [index,test] of state.tests) if (!test.manual) state.tests.delete(index);
        pruneGroups();
        state.script=args.source;
        let group='';
        for (const line of args.source.split('\n')) {
          if (!line.trim()) continue;
          const annotation=line.match(/^<#-- @group (.+) -->$/);
          if (annotation) {group=annotation[1];continue;}
          const match=line.match(/^(.*?)\s+>\s+(\d+)$/);
          assert(match,'Unexpected script line: '+line);
          const index=Number(match[2]);
          assert(!state.tests.has(index),'Generated test collides with a manual test');
          state.tests.set(index,{index,manual:false,description:'',useInStatements:false,group,
            ...(state.pointsEnabled?{points:0}:{}),scriptLine:line});
          ensureGroup(group);
        }
        return {};
      }
      case 'saveTest': {
        const index=Number(args.testIndex);
        const previous=state.tests.get(index);
        const test=copy(previous||{index,manual:true,description:'',useInStatements:false});
        if ('testInput' in args) {
          assert(!previous || previous.manual,'Cannot turn generated test into manual without deleting it');
          test.input=args.testInput;test.inputBase64=Buffer.from(args.testInput).toString('base64');
        }
        if (!previous) assert('testInput' in args,'New manual test requires input');
        if ('testGroup' in args) {assert(state.groupsEnabled);test.group=args.testGroup;ensureGroup(args.testGroup);}
        if ('testPoints' in args) {
          assert(state.pointsEnabled);
          assert(Number.isFinite(Number(args.testPoints)) && Number(args.testPoints)>=0);
          if (!state.ignorePoints) test.points=Number(args.testPoints);
        }
        if ('testUseInStatements' in args) test.useInStatements=flag(args.testUseInStatements);
        for (const [param,key] of Object.entries({testDescription:'description',testInputForStatements:'inputForStatement',
          testOutputForStatements:'outputForStatement',testInteractionLogForStatements:'interactionLogForStatement'}))
          if (param in args) test[key]=args[param];
        state.tests.set(index,test);pruneGroups();return {};
      }
      case 'setTestGroup': {
        assert(state.groupsEnabled, 'Test groups must be enabled before bulk assignment');
        assert.deepEqual(Object.keys(args).sort(), ['testGroup','testIndices','testset']);
        assert.equal(args.testset, 'tests');
        assert.equal(typeof args.testGroup, 'string');
        assert(args.testGroup, 'Empty-group clearing stays on the saveTest path');
        assert(/^\d+(?:,\d+)*$/.test(args.testIndices), 'Use comma-separated test indices');
        const indices = args.testIndices.split(',').map(Number);
        assert.equal(new Set(indices).size, indices.length, 'No repeated indices');
        for (const index of indices) assert(state.tests.has(index), 'Tests must exist before bulk assignment');
        ensureGroup(args.testGroup);
        for (const index of indices) state.tests.get(index).group = args.testGroup;
        pruneGroups();return {};
      }
      case 'deleteTest':
        for (const index of String(args.testIndices??args.testIndex).split(',')) state.tests.delete(Number(index));
        pruneGroups();return {};
      case 'viewTestGroup':return state.groupsEnabled?copy([...state.groups.values()]):[];
      case 'saveTestGroup': {
        assert(state.groupsEnabled);
        const old=state.groups.get(args.group);assert(old,'Groups must be created by a test first');
        const next={...old};
        for (const key of ['pointsPolicy','feedbackPolicy']) if (key in args) next[key]=args[key];
        if ('dependencies' in args) next.dependencies=args.dependencies?args.dependencies.split(','):[];
        state.groups.set(args.group,next);acyclic();return {};
      }
      case 'viewTags':return copy(state.tags);
      case 'saveTags':state.tags=args.tags?args.tags.split(','):[];return {};
      case 'stresses':return [];
      case 'validatorTests':return copy(state.validatorTests);
      case 'checkerTests':return copy(state.checkerTests);
      case 'saveValidatorTest':case 'saveCheckerTest': {
        const tests=method==='saveValidatorTest'?state.validatorTests:state.checkerTests;
        const test={index:args.testIndex,expectedVerdict:args.testVerdict,input:args.testInput,
          ...(method==='saveValidatorTest'?{testset:args.testset||'tests',group:args.testGroup||''}:{}),
          ...(args.testOutput!=null?{output:args.testOutput,answer:args.testAnswer}:{})};
        const index=tests.findIndex(test=>test.index===args.testIndex);
        if (index<0) tests.push(test);else tests[index]=test;return {};
      }
      case 'deleteValidatorTest':case 'deleteCheckerTest': {
        const key=method==='deleteValidatorTest'?'validatorTests':'checkerTests';
        assert(state[key].some(test=>test.index===args.testIndex));
        state[key]=state[key].filter(test=>test.index!==args.testIndex);return {};
      }
      case 'commitChanges':state.commits++;state.entry.modified=false;return {committed:true};
      default:throw Error('Unexpected API call: '+method);
    }
  }
  const api={
    async call(method) {
      calls.push({method});
      if (method==='problems.list') return [copy(state.entry)];
      if (method==='problem.create') {state.creates++;return copy(state.entry);}
      throw Error('Unexpected API call: '+method);
    },
    async problem(method,id,args={}) {
      assert.equal(id,42);calls.push({method,args:copy(args)});
      const fail=state.fail;
      const fire=fail && !fail.fired && fail.method===method && (!fail.when||fail.when(args));
      if (fire) fail.fired=true;
      if (fire && !fail.after) throw Error('Injected failure before '+method);
      const result=apply(method,args);
      if (writes.test(method) && method!=='commitChanges') state.entry.modified=true;
      if (fire) throw Error('Injected failure after '+method);
      return result;
    }
  };
  return {api,state,calls};
}
