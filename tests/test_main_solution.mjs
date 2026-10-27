import './helpers/i18n.mjs';
// Regression tests for Polygon's single Main (MA) solution invariant.
import assert from 'node:assert/strict';
import {syncPackage} from '../src/polygon/sync.js';

const info = {timeLimit:1000, memoryLimit:256, inputFile:'stdin',
  outputFile:'stdout', interactive:false};
const sol = (name, tag, content = name + '-v1') => ({name, tag, content});
const desired = (name, tag) => ({name, tag, path:name});

function fixture(initial, wanted, files = {}) {
  const state = new Map(initial.map(s => [s.name, {...s}]));
  const calls = [];
  let fail = null;
  const plan = {info, statements:[], sources:[], resources:[], aux:[],
    solutions:wanted, checker:'', validator:'', interactor:'', tests:[],
    groups:[], validatorTests:[], checkerTests:[], tags:[]};
  const archive = {async text(path) {return files[path] ?? path + '-v1';}};
  const api = {
    async problem(method, id, args = {}) {
      switch (method) {
        case 'info': return info;
        case 'viewTags': return [];
        case 'viewSolution': return state.get(args.name)?.content;
        case 'tests': return [];
        case 'saveSolution': {
          calls.push({method, ...args});
          if (fail && !fail.fired && args.name === fail.name && fail.when === 'before') {
            fail.fired = true;
            throw Error('connection lost before request completed');
          }
          const previous = state.get(args.name);
          if (!previous && typeof args.file !== 'string') throw Error('New solutions require source');
          const tag = args.tag ?? previous?.tag ?? 'OK';
          const content = args.file ?? previous.content;
          if (tag === 'MA' && [...state.values()].some(s => s.tag === 'MA' && s.name !== args.name))
            throw Error('You already have Main correct solution');
          state.set(args.name, {name:args.name, tag, content});
          if (fail && !fail.fired && args.name === fail.name && fail.when === 'after') {
            fail.fired = true;
            throw Error('connection lost after server committed request');
          }
          return {};
        }
        case 'deleteSolution':
          calls.push({method, ...args});
          if (!state.delete(args.name)) throw Error('Missing solution');
          return {};
        default: throw Error('Unexpected method: ' + method);
      }
    }
  };
  return {
    state, calls,
    setFailure(name, when) { fail = {name, when, fired:false}; },
    clearFailure() { fail = null; },
    async run() {
      const snapshot = {solutions:[...state.values()].map(s => ({
        name:s.name, tag:s.tag, length:new TextEncoder().encode(s.content).length
      })), statements:{}, statementResources:[],
        files:{sourceFiles:[], resourceFiles:[], auxFiles:[]}, tests:[]};
      return syncPackage({api, id:883, plan, archive, target:snapshot,
        read:(label, fn) => fn(), write:(label, fn) => fn()});
    }
  };
}

// A ZIP from another source uses a different filename for its MCS.
const replaced = fixture([sol('rlatjwls3333_sol.cpp', 'MA', 'existing source')],
  [desired('MCS.cpp', 'MA')]);
await replaced.run();
assert.deepEqual([...replaced.state.keys()], ['MCS.cpp']);
assert.equal(replaced.state.get('MCS.cpp').tag, 'MA');
assert.deepEqual(replaced.calls.map(c => [c.method, c.name, c.tag]), [
  ['saveSolution', 'rlatjwls3333_sol.cpp', 'OK'],
  ['saveSolution', 'MCS.cpp', 'MA'],
  ['deleteSolution', 'rlatjwls3333_sol.cpp', undefined]
]);
assert(!Object.hasOwn(replaced.calls[0], 'file'), 'demotion must not re-upload source');
assert.equal(replaced.calls[1].file, 'MCS.cpp-v1');
replaced.calls.length = 0;
assert.equal((await replaced.run()).mutations, 0);
assert.deepEqual(replaced.calls, []);
console.log('PASS: replacing an existing MCS, deleting obsolete original, rerunning is a no-op');

// An old main which remains in the ZIP must get its intended non-MA tag.
const retained = fixture([sol('old.cpp', 'MA')],
  [desired('new.cpp', 'MA'), desired('old.cpp', 'WA')],
  {'old.cpp':'new content'});
await retained.run();
assert.equal(retained.state.get('old.cpp').tag, 'WA');
assert.equal(retained.state.get('old.cpp').content, 'new content');
assert.equal(retained.state.get('new.cpp').tag, 'MA');
assert.deepEqual(retained.calls.filter(c => c.name === 'old.cpp').map(c => c.tag),
  ['WA', undefined], 'old tag should be demoted once; content may update separately');
assert.deepEqual(retained.calls.filter(c => c.name === 'old.cpp').map(c => c.file),
  [undefined, 'new content'], 'do not replace old source until uploading new MCS');
assert(!retained.calls.some(c => c.method === 'deleteSolution'));
console.log('PASS: previous MCS retained under another tag with updated content');

// A failed upload must leave the old source intact; the next run completes.
for (const when of ['before', 'after']) {
  const interrupted = fixture([sol('old.cpp', 'MA', 'original')],
    [desired('new.cpp', 'MA')]);
  interrupted.setFailure('new.cpp', when);
  await assert.rejects(interrupted.run(), /connection lost/);
  assert.equal(interrupted.state.get('old.cpp')?.content, 'original');
  assert.equal(interrupted.state.get('old.cpp')?.tag, 'OK');
  interrupted.clearFailure();
  await interrupted.run();
  assert.deepEqual([...interrupted.state.keys()], ['new.cpp']);
  assert.equal(interrupted.state.get('new.cpp').tag, 'MA');
  console.log('PASS: resume after interrupted MCS upload (' + when + ')');
}

// Same filename: update content without trying to replace the MA tag.
const sameName = fixture([sol('MCS.cpp', 'MA', 'old content')],
  [desired('MCS.cpp', 'MA')], {'MCS.cpp':'new content'});
await sameName.run();
assert.equal(sameName.state.get('MCS.cpp').content, 'new content');
assert.deepEqual(sameName.calls.map(c => [c.method, c.tag]), [['saveSolution', undefined]]);
assert.equal(sameName.calls[0].file, 'new content');
console.log('PASS: same MCS filename updates content in place');

// Polygon permits tag-only edits without resending the source.
const tagOnly = fixture([sol('unchanged.cpp', 'OK', 'same source')],
  [desired('unchanged.cpp', 'WA')], {'unchanged.cpp':'same source'});
await tagOnly.run();
assert.deepEqual(tagOnly.calls.map(c => [c.method, c.name, c.tag, c.file]), [
  ['saveSolution', 'unchanged.cpp', 'WA', undefined]
]);
assert.equal((await tagOnly.run()).mutations, 0);
assert.equal(tagOnly.state.get('unchanged.cpp').content, 'same source');
console.log('PASS: tag-only update preserves source without re-uploading it');

// An invalid package must fail before any mutation.
for (const invalid of [
  [desired('a.cpp','MA'), desired('b.cpp','MA')],
  [desired('a.cpp','MA'), desired('a.cpp','OK')]
]) {
  const f = fixture([sol('old.cpp','MA')], invalid);
  await assert.rejects(f.run(), /메인 솔루션이 여러 개|이름이 중복/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.state.get('old.cpp').tag, 'MA');
}
console.log('PASS: ambiguous ZIP solution lists are rejected without mutations');
