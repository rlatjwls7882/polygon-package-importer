import { t } from '../../i18n.js';
import { canonicalExtraTags } from '../../package/metadata.js';

const sameSet = (a, b) => {
  const aa = new Set(a), bb = new Set(b);
  return aa.size === a.length && bb.size === b.length && a.length === b.length && a.every(value => bb.has(value));
};
const terminalVerdicts = new Set(['OK','WA','PE','TL','ML','IL','RE','CE','FL','RJ']);

export function checkInvocation(detail, pkg, plan) {
  const invocation = detail?.invocation;
  if (!invocation || Number(invocation.packageId) !== Number(pkg.id) || invocation.testset !== 'tests' ||
      !Array.isArray(invocation.solutions) || !Array.isArray(invocation.tests) ||
      !Array.isArray(detail.runs) || !Array.isArray(detail.solutionTags))
    throw Error(t('verifyInvalidResponse'));
  if (invocation.status === 'ABORTED' || invocation.violateTag === true)
    throw Error(t('verifyInvocationFailed', invocation.id));
  if (!['PENDING','RUNNING','FINISHED'].includes(invocation.status)) throw Error(t('verifyInvalidResponse'));
  if (invocation.status !== 'FINISHED') return null;
  if (invocation.violateTag !== false) throw Error(t('verifyInvalidResponse'));

  const expectedSolutions = plan.solutions.filter(solution => {
    const testsetTag = solution.extraTags?.find(tag => tag.testset === 'tests')?.tag || solution.tag;
    return testsetTag !== 'NR' || solution.extraTags?.some(tag => tag.testGroup && tag.tag !== 'NR');
  }).map(solution => solution.name);
  if (!sameSet(invocation.solutions, expectedSolutions) ||
      !sameSet(invocation.tests.map(Number), plan.tests.map(test => test.index)))
    throw Error(t('verifyInvocationCoverage'));
  const solutionNames = new Set(expectedSolutions);
  const tags = new Map(detail.solutionTags.map(value => [value.name, value]));
  if (tags.size !== detail.solutionTags.length || !sameSet([...tags.keys()], expectedSolutions))
    throw Error(t('verifyInvocationCoverage'));
  for (const solution of plan.solutions.filter(solution => solutionNames.has(solution.name))) {
    const stored = tags.get(solution.name);
    const extras = [
      ...Object.entries(stored.testsetTags || {}).map(([testset,tag]) => ({testset,tag})),
      ...Object.entries(stored.groupTags || {}).map(([testGroup,tag]) => ({testGroup,tag}))
    ];
    if (stored.tag !== solution.tag || JSON.stringify(canonicalExtraTags(extras)) !==
        JSON.stringify(canonicalExtraTags(solution.extraTags || [])))
      throw Error(t('verifySolutionTagsMismatch', solution.name));
  }
  const solutionIndices = new Map(expectedSolutions.map((name, index) => [name, index]));
  const testIndices = new Map(plan.tests.map((test, index) => [test.index, index]));
  const pairCount = expectedSolutions.length * plan.tests.length;
  // The importer allows at most 5,000 ZIP entries and 1,000 tests. Guard
  // malformed responses/plans before allocating a dense coverage bitmap.
  if (!Number.isSafeInteger(pairCount) || pairCount > 5_000_000)
    throw Error(t('verifyInvocationCoverage'));
  const seen = new Uint8Array(Math.ceil(pairCount / 8));
  const mainNames = new Set(plan.solutions.filter(solution => solution.tag === 'MA').map(solution => solution.name));
  let count = 0, unfinished = false;
  for (const run of detail.runs) {
    const solutionIndex = solutionIndices.get(run.solution), testIndex = testIndices.get(Number(run.test));
    if (solutionIndex === undefined || testIndex === undefined)
      throw Error(t('verifyInvocationCoverage'));
    const position = solutionIndex * plan.tests.length + testIndex;
    const byte = position >>> 3, bit = 1 << (position & 7);
    if (seen[byte] & bit) throw Error(t('verifyInvocationCoverage'));
    seen[byte] |= bit; count++;
    if (run.violateTag === true || ['CE','FL'].includes(run.verdict) ||
        (mainNames.has(run.solution) &&
          terminalVerdicts.has(run.verdict) && run.verdict !== 'OK'))
      throw Error(t('verifyRunFailed', run.solution, run.test, run.verdict, run.comment || ''));
    if (run.violateTag !== false) throw Error(t('verifyInvalidResponse'));
    if (['NO','TS'].includes(run.verdict)) unfinished = true;
    else if (!terminalVerdicts.has(run.verdict)) throw Error(t('verifyInvalidResponse'));
  }
  if (unfinished || count !== pairCount) return null;
  return {invocationId:invocation.id, solutions:expectedSolutions.length, tests:plan.tests.length, runs:count};
}
