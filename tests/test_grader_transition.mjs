import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';

for (const requiresFile of [false, true]) test(`obsolete graders are unlinked before standalone solutions compile: file required=${requiresFile}`, async () => {
  const first = fixture({grader:true}), next = fixture(), mock = createPolygon();
  await first.upload(mock);
  const original = mock.api.problem, calls = [];
  mock.api.problem = async (method, id, args = {}, options) => {
    calls.push({method, args:{...args}});
    if (method === 'saveFile' && requiresFile && !Object.hasOwn(args, 'file'))
      throw Error('problem.saveFile: file: Field should not be empty');
    if (method === 'saveSolution' && args.file?.includes('int main'))
      assert(!mock.state.fileMetadata.resource.get('grader.cpp')?.resourceAdvancedProperties,
        'The old grader adds a second main during saveSolution');
    return original(method, id, args, options);
  };
  await next.upload(mock, 'replace');
  const clear = calls.findIndex(call => call.method === 'saveFile' && call.args.forTypes === '');
  const solution = calls.findIndex(call => call.method === 'saveSolution');
  const deleted = calls.findIndex(call => call.method === 'deleteFile' && call.args.name === 'grader.cpp');
  assert(clear >= 0 && clear < solution && solution < deleted);
  const updates = calls.filter(call => call.method === 'saveFile' && call.args.forTypes === '');
  assert.equal(updates.length, requiresFile ? 2 : 1);
  if (requiresFile) assert.equal(updates[1].args.file, first.contents['files/grader.cpp']);
  assert.equal(mock.state.solutions.get('main.cpp').file, next.contents['solutions/main.cpp']);
  assert(!mock.state.files.resource.has('grader.cpp'));
});

for (const after of [false, true]) test(`uncertain resource edits are not automatically retried: after=${after}`, async () => {
  const first = fixture({grader:true}), next = fixture(), mock = createPolygon();
  await first.upload(mock);
  const original = mock.api.problem;
  let attempts = 0, fail = true;
  mock.api.problem = async (method, id, args = {}, options) => {
    if (method === 'saveFile' && args.forTypes === '' && fail) {
      attempts++;
      if (after) await original(method, id, args, options);
      throw Error('Network response lost');
    }
    return original(method, id, args, options);
  };
  await assert.rejects(() => next.upload(mock, 'replace'), /Network response lost/);
  assert.equal(attempts, 1);
  assert.equal(mock.state.commits, 1);
  assert.equal(mock.state.files.resource.get('grader.cpp'), first.contents['files/grader.cpp']);
  assert.equal(mock.state.solutions.get('main.cpp').file, first.contents['solutions/main.cpp']);
  fail = false;
  await next.upload(mock, 'replace');
  assert.equal(mock.state.solutions.get('main.cpp').file, next.contents['solutions/main.cpp']);
});

test('a previous graded main is demoted while its original grader still applies', async () => {
  const first = fixture({grader:true}), next = fixture({mutate({solutions, contents}) {
    solutions[0].children[0].attributes.path = 'solutions/new.cpp';
    contents['solutions/new.cpp'] = contents['solutions/main.cpp'];
  }}), mock = createPolygon();
  await first.upload(mock);
  const original = mock.api.problem;
  mock.api.problem = async (method, id, args = {}, options) => {
    if (method === 'saveSolution') {
      if (!Object.hasOwn(args, 'file')) throw Error('problem.saveSolution: file: Field should not be empty');
      const linked = !!mock.state.fileMetadata.resource.get('grader.cpp')?.resourceAdvancedProperties;
      assert.equal(linked, args.name === 'main.cpp', 'Demotion compiles the old body; upload compiles the new body');
    }
    return original(method, id, args, options);
  };
  await next.upload(mock, 'replace');
  assert.deepEqual([...mock.state.solutions.keys()], ['new.cpp']);
  assert.equal(mock.state.solutions.get('new.cpp').tag, 'MA');
});

for (const bytes of [[255], [0]]) test(`unreadable old resource text is never re-uploaded: ${bytes}`, async () => {
  const first = fixture({grader:true}), next = fixture(), mock = createPolygon();
  await first.upload(mock);
  const original = mock.api.problem;
  let writes = 0;
  mock.api.problem = async (method, id, args = {}, options) => {
    if (method === 'saveFile' && args.forTypes === '') {
      writes++;
      if (!Object.hasOwn(args, 'file')) throw Error('problem.saveFile: file: Field should not be empty');
    }
    if (method === 'viewFile' && args.name === 'grader.cpp') return new Blob([Uint8Array.from(bytes)]);
    return original(method, id, args, options);
  };
  await assert.rejects(() => next.upload(mock, 'replace'), error => error.message.includes('grader.cpp'));
  assert.equal(writes, 1);
  assert.equal(mock.state.commits, 1);
  assert.equal(mock.state.files.resource.get('grader.cpp'), first.contents['files/grader.cpp']);
});

test('compiler-only file edits include original content only after an explicit required-file refusal', async () => {
  const f = fixture(), mock = createPolygon();
  await f.upload(mock);
  mock.state.fileMetadata.source.get('val.cpp').sourceType = 'cpp.g++17';
  const original = mock.api.problem, attempts = [];
  mock.api.problem = async (method, id, args = {}, options) => {
    if (method === 'saveFile') {
      attempts.push({...args});
      if (!Object.hasOwn(args, 'file')) throw Error('problem.saveFile: file: Field should not be empty');
    }
    return original(method, id, args, options);
  };
  await f.upload(mock, 'replace');
  assert.equal(attempts.length, 2);
  assert(!Object.hasOwn(attempts[0], 'file'));
  assert.equal(attempts[1].file, f.contents['files/val.cpp']);
  assert(attempts.every(args => args.sourceType === 'cpp.gcc13-64-winlibs-g++20'));
});
