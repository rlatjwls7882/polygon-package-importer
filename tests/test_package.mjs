import './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMockI18n } from './helpers/i18n.mjs';
import { installDOMParser } from './helpers/xml.mjs';
import { ZipArchive } from '../src/package/zip.js';
import { loadPolygonPackage } from '../src/package/load.js';
import { executeImport } from '../src/polygon/import.js';

const [directory, casesPath] = process.argv.slice(2);
const cases = JSON.parse(await readFile(casesPath, 'utf8'));
async function fixture(name) {
  installDOMParser(cases[name]);
  const bytes = await readFile(join(directory, name + '.zip'));
  const file = {size:bytes.length, arrayBuffer:async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)};
  return {file, plan:await loadPolygonPackage(await ZipArchive.fromFile(file))};
}
const batch = (await fixture('batch')).plan;
assert.equal(batch.info.interactive, false);
assert.equal(batch.interactor, '');
assert.deepEqual(batch.groups, []);
assert.deepEqual(batch.unsupported, []);
const interactive = (await fixture('interactive')).plan;
assert.equal(interactive.info.interactive, true);
assert.equal(interactive.interactor, 'interactor.cpp');
assert(interactive.sources.some(source => source.name === 'interactor.cpp'));
assert.deepEqual(interactive.unsupported, []);
console.log('PASS: batch and interactive package readers preserve judging settings and sources');

const independent = (await fixture('subtasks-independent')).plan;
assert.deepEqual(independent.groups.map(group => group.dependencies), [[], []]);
assert.deepEqual(independent.tests.map(test => [test.group, test.points]), [['small',30],['large',70]]);
const dependent = (await fixture('subtasks-dependent')).plan;
assert.deepEqual(dependent.groups.map(group => [group.name, group.dependencies]), [['large',['small']],['small',[]]]);
assert.deepEqual(dependent.tests.map(test => [test.group, test.points]), [['small',30],['large',70]]);
assert.deepEqual(dependent.unsupported, []);
console.log('PASS: independent groups and explicit dependency edges survive package parsing, including reverse declaration order');

const selfTests = (await fixture('self-tests')).plan;
assert.equal(selfTests.validatorTests[0].verdict, 'VALID');
assert.equal(selfTests.checkerTests[0].verdict, 'OK');
assert.equal(selfTests.checkerTests[0].answerPath, 'checker/01.ans');
assert.deepEqual(selfTests.unsupported, []);
for (const locale of ['ko', 'en']) {
  chrome.i18n = createMockI18n(locale);
  for (const name of ['bad-input', 'missing-generator', 'bad-self-test']) {
    const {file, plan} = await fixture(name);
    assert(plan.unsupported.length > 0, name);
    assert(!plan.unsupported.some(message => message.includes('is not a function')));
    assert(plan.unsupported.every(message => /[가-힣]/.test(message) === (locale === 'ko')));
    let calls = 0;
    await assert.rejects(() => executeImport({job:{file, mode:'create'}, api:{call(){calls++;}}}),
      error => error instanceof Error && !(error instanceof TypeError));
    assert.equal(calls, 0, 'Invalid package must be rejected before problem creation');
  }
}
console.log('PASS: malformed test inputs, missing generators and corrupt judge tests return localized errors before any remote write');
