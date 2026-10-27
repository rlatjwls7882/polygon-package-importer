import { t } from '../i18n.js';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const flag = value => value === true || value === false || value === 'true' || value === 'false';
const index = value => (typeof value === 'number' || typeof value === 'string') &&
  /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const named = value => record(value) && typeof value.name === 'string' && value.name.length > 0;

function uniqueRows(values, key, valid, message) {
  if (!Array.isArray(values)) throw Error(t(message));
  const seen = new Set();
  for (const value of values) {
    if (!valid(value)) throw Error(t(message));
    const identity = key(value);
    if (seen.has(identity)) throw Error(t(message));
    seen.add(identity);
  }
  return values;
}

export function testsSnapshot(values) {
  return uniqueRows(values, test => Number(test.index),
    test => record(test) && index(test.index) && flag(test.manual), 'syncInvalidResponseWhenReloadingTests');
}

export function filesSnapshot(value) {
  if (!record(value)) throw Error(t('polygonImportCouldNotReadAllExistingProblemData'));
  for (const key of ['sourceFiles','resourceFiles','auxFiles'])
    namedSnapshot(value[key]);
  return value;
}

export function namedSnapshot(value) {
  return uniqueRows(value, item => item.name, named, 'polygonImportCouldNotReadAllExistingProblemData');
}

export function statementsSnapshot(value) {
  if (!record(value) || Object.values(value).some(statement => !record(statement)))
    throw Error(t('polygonImportCouldNotReadAllExistingProblemData'));
  return value;
}

export function judgeTestsSnapshot(value, kind) {
  return uniqueRows(value, test => Number(test.index), test => record(test) && Number.isInteger(test.index) && test.index > 0 &&
    typeof test.input === 'string' && typeof test.expectedVerdict === 'string' &&
    (kind !== 'checker' || (typeof test.output === 'string' && typeof test.answer === 'string')),
    'formatInvalidJudgeTests');
}

export function infoSnapshot(value) {
  if (!record(value) || !['timeLimit','memoryLimit'].every(key =>
      Number.isFinite(Number(value[key])) && Number(value[key]) > 0) ||
      !['inputFile','outputFile'].every(key => typeof value[key] === 'string') ||
      ['interactive','runTwice','interactiveSecondRun','useInteractionLogInExampleTests','wellFormed'].some(key =>
        value[key] !== undefined && !flag(value[key])))
    throw Error(t('syncJudgingMismatch'));
  return value;
}

export function judgeSnapshot(value) {
  if (value != null && typeof value !== 'string') throw Error(t('syncJudgingMismatch'));
  return value;
}

export function tagsSnapshot(value) {
  if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string' && !named(tag)))
    throw Error(t('polygonImportCouldNotReadAllExistingProblemData'));
  return value;
}
