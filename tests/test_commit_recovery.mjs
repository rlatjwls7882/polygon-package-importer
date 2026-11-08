import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitProblem } from '../src/polygon/commit.js';
import { fixture } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { attachBuild } from './helpers/build.mjs';
import { executeImport } from '../src/polygon/import.js';
import { installNativeTestParser } from './helpers/native-xml.mjs';

function uncertain(after, {readFails = false} = {}) {
  const failure = Error('Commit response lost'), calls = [];
  return {failure, calls, api:{
    async problem(method, id) { calls.push([method, id]); throw failure; },
    async call(method, args) {
      calls.push([method, args]);
      if (readFails) throw Error('Confirmation unavailable');
      return after;
    }
  }};
}
const clean = {id:42, revision:8, workingCopyRevision:8, modified:false, accessType:'OWNER'};

test('one clean new revision can proceed only to mandatory verification, without another commit', async () => {
  const e = uncertain([clean]);
  assert.deepEqual(await commitProblem({api:e.api, id:42, revision:7, verify:true}), {recovered:true, revision:8});
  assert.equal(e.calls.filter(([method]) => method === 'commitChanges').length, 1);
  assert.equal(e.calls.filter(([method]) => method === 'problems.list').length, 1);
});

for (const after of [[], null, [{...clean, modified:true}], [{...clean, revision:7}],
  [{...clean, revision:9, workingCopyRevision:9}], [{...clean, workingCopyRevision:7}],
  [{...clean, deleted:true}], [{...clean, accessType:'READ'}], [{...clean, id:99}], [clean, clean]])
  test(`an unconfirmed commit remains a failure: ${JSON.stringify(after)}`, async () => {
    const e = uncertain(after);
    await assert.rejects(() => commitProblem({api:e.api, id:42, revision:7, verify:true}), error => error === e.failure);
    assert.notEqual(e.failure.committed, true);
    assert.equal(e.calls.filter(([method]) => method === 'commitChanges').length, 1);
  });

test('a failed confirmation preserves the original commit error', async () => {
  const e = uncertain([clean], {readFails:true});
  await assert.rejects(() => commitProblem({api:e.api, id:42, revision:7, verify:true}), error => error === e.failure);
});

test('upload-only jobs report a confirmed commit but still stop on the original error', async () => {
  const e = uncertain([clean]);
  await assert.rejects(() => commitProblem({api:e.api, id:42, revision:7, verify:false}), error =>
    error === e.failure && error.committed === true);
});

test('a new target without a known prior revision never recovers an uncertain commit', async () => {
  const e = uncertain([clean]);
  await assert.rejects(() => commitProblem({api:e.api, id:42, verify:true}), error => error === e.failure);
  assert.equal(e.calls.length, 1);
});

for (const corruptBuild of [false, true]) test(`commit confirmation still checks the actual build: corrupt=${corruptBuild}`, async () => {
  const f = fixture(), mock = createPolygon();
  await f.upload(mock);
  const build = attachBuild(mock), original = mock.api.problem, progress = [];
  mock.state.info.wellFormed = false;
  mock.api.problem = async (method, id, args, options) => {
    const result = await original(method, id, args, options);
    if (method === 'commitChanges') {
      throw Error('Commit response lost');
    }
    return result;
  };
  if (corruptBuild) build.afterBuild = record => { record.pkg.state = 'FAILED'; record.pkg.comment = 'Compiler error'; };
  installNativeTestParser();
  const run = () => executeImport({api:mock.api,
    job:{file:f.file, mode:'replace', problemId:'42', commit:true, verify:true},
    onProgress:async value => progress.push(value),
    verificationOptions:{maxPolls:2, pollMs:0, sleep:async () => {}}});
  if (corruptBuild) {
    await assert.rejects(run, error => error.committed === true);
    assert(!progress.some(value => value.stage === 'verified'));
  } else assert.equal((await run()).verification.state, 'verified');
  assert.equal(mock.state.commits, 2);
  assert.equal(build.builds, 1);
});

test('a revision change after commit confirmation stops before launching a build', async () => {
  const f = fixture(), mock = createPolygon();
  await f.upload(mock);
  const build = attachBuild(mock), problem = mock.api.problem, call = mock.api.call;
  let lost = false, confirmed = false;
  mock.state.info.wellFormed = false;
  mock.api.problem = async (method, ...args) => {
    const value = await problem(method, ...args);
    if (method === 'commitChanges') { lost = true; throw Error('Commit response lost'); }
    return value;
  };
  mock.api.call = async (...args) => {
    const value = await call(...args);
    if (lost && !confirmed) {
      confirmed = true;
      mock.state.entry.revision++;
      mock.state.entry.workingCopyRevision++;
    }
    return value;
  };
  installNativeTestParser();
  await assert.rejects(() => executeImport({api:mock.api,
    job:{file:f.file, mode:'replace', problemId:'42', commit:true, verify:true}}),
    error => error.committed === true && error.partial === true);
  assert(confirmed);
  assert.equal(build.builds, 0);
});

test('upload-only confirmation reports partial committed work even without new data writes', async () => {
  const f = fixture({groups:false}), mock = createPolygon();
  await f.upload(mock);
  const build = attachBuild(mock), original = mock.api.problem;
  mock.state.entry.modified = true;
  mock.api.problem = async (method, ...args) => {
    const value = await original(method, ...args);
    if (method === 'commitChanges') throw Error('Commit response lost');
    return value;
  };
  installNativeTestParser();
  await assert.rejects(() => executeImport({api:mock.api,
    job:{file:f.file, mode:'replace', problemId:'42', commit:true, verify:false}}),
    error => error.committed === true && error.partial === true &&
      error.message === chrome.i18n.getMessage('verifyCommitConfirmedNotVerified', ['2']));
  assert.equal(mock.state.commits, 2);
  assert.equal(build.builds, 0);
});
