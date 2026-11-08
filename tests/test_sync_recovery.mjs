import './helpers/i18n.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, n } from './helpers/format-fixture.mjs';
import { createPolygon } from './helpers/polygon.mjs';
import { readTarget } from '../src/polygon/target.js';
import { syncPackage } from '../src/polygon/sync.js';

const task = (_, run) => run();
const mutation = /^(?:save|set|delete|clear|enable|edit|updateInfo)/;

function packageFixture(options, version) {
  return fixture({...options, mutate({root, contents}) {
    root.children.find(node => node.tag === 'files').children.find(node => node.tag === 'resources')
      .children.push(n('file', {path:'files/header.h'}));
    contents['files/header.h'] = `#define VERSION ${version}\n// 한국어 Україна 😀\r\n`;
    for (const key of Object.keys(contents)) if (key.endsWith('.cpp'))
      contents[key] = '#include "header.h"\n' + contents[key] + `\n// ${version}\n`;
  }});
}

async function synchronize(mock, f, plan, replace = true) {
  return syncPackage({api:mock.api, id:42, plan,
    archive:{text:async path => f.contents[path]},
    target:replace ? await readTarget(mock.api, 42, plan) : null,
    read:task, write:task});
}

function comparable(state) {
  const result = structuredClone(state);
  result.fail = null;
  return result;
}

for (const [before, after] of [
  [{}, {interactive:true, twice:true, generated:true, extraTags:true}],
  [{interactive:true, twice:true, generated:true, extraTags:true}, {groups:false}],
  [{groups:false}, {interactive:true, twice:true, extraTags:true, selfTests:true}],
  [{extraTags:true, selfTests:true}, {generated:true, omitSamples:true, groups:false}]
]) test(`every interrupted write converges on retry: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`, async t => {
  const first = packageFixture(before, 1), next = packageFixture(after, 2);
  const [firstPlan, nextPlan] = await Promise.all([first.parse(), next.parse()]);
  const seed = createPolygon();
  await synchronize(seed, first, firstPlan, false);
  const initial = structuredClone(seed.state);
  const reference = createPolygon();
  Object.assign(reference.state, structuredClone(initial));
  await synchronize(reference, next, nextPlan);
  const writes = reference.calls.filter(call => mutation.test(call.method));
  assert(writes.length > 10, 'The transition must exercise several mutation stages');
  t.diagnostic(`${writes.length * 2} interruptions: before and after every mutation`);
  for (let stop = 0; stop < writes.length; stop++) for (const afterWrite of [false, true]) {
    const mock = createPolygon();
    Object.assign(mock.state, structuredClone(initial));
    const original = mock.api.problem;
    let position = 0, fired = false;
    mock.api.problem = async (method, id, args, options) => {
      const fail = mutation.test(method) && position++ === stop;
      if (fail) fired = true;
      if (fail && !afterWrite) throw Error('Interrupted write');
      const value = await original(method, id, args, options);
      if (fail) throw Error('Interrupted write');
      return value;
    };
    await assert.rejects(() => synchronize(mock, next, nextPlan), /Interrupted write/);
    assert(fired, `Write ${stop} was not exercised`);
    mock.api.problem = original;
    await synchronize(mock, next, nextPlan);
    assert.deepEqual(comparable(mock.state), comparable(reference.state),
      `${writes[stop].method} (${afterWrite ? 'lost response' : 'before request'})`);
  }
});
