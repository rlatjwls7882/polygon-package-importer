import { t } from '../i18n.js';
import { ZipArchive } from '../package/zip.js';
import { canonicalExtraTags } from '../package/metadata.js';
import { verifyBuiltDescriptor } from './descriptor.js';

const sameSet = (a, b) => {
  const aa = new Set(a), bb = new Set(b);
  return aa.size === a.length && bb.size === b.length && a.length === b.length && a.every(value => bb.has(value));
};
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const terminalVerdicts = new Set(['OK','WA','PE','TL','ML','IL','RE','CE','FL','RJ']);

async function currentRevision(api, id) {
  const problems = await api.call('problems.list', {id});
  const problem = Array.isArray(problems) && problems.find(problem => Number(problem.id) === id && !problem.deleted);
  if (!problem || !['WRITE','OWNER'].includes(problem.accessType) || problem.modified ||
      !validId(problem.revision) || (problem.workingCopyRevision != null &&
        Number(problem.workingCopyRevision) !== Number(problem.revision)))
    throw Error(t('verifyNeedsCleanRevision'));
  return Number(problem.revision);
}

function packages(value) {
  if (!Array.isArray(value) || value.some(item => !validId(item.id) || !validId(item.revision) ||
      !['PENDING','RUNNING','READY','FAILED'].includes(item.state)) ||
      new Set(value.map(item => Number(item.id))).size !== value.length)
    throw Error(t('verifyInvalidResponse'));
  return value;
}

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
  const tags = new Map(detail.solutionTags.map(value => [value.name, value]));
  if (tags.size !== detail.solutionTags.length || !sameSet([...tags.keys()], expectedSolutions))
    throw Error(t('verifyInvocationCoverage'));
  for (const solution of plan.solutions.filter(solution => expectedSolutions.includes(solution.name))) {
    const stored = tags.get(solution.name);
    const extras = [
      ...Object.entries(stored.testsetTags || {}).map(([testset,tag]) => ({testset,tag})),
      ...Object.entries(stored.groupTags || {}).map(([testGroup,tag]) => ({testGroup,tag}))
    ];
    if (stored.tag !== solution.tag || JSON.stringify(canonicalExtraTags(extras)) !==
        JSON.stringify(canonicalExtraTags(solution.extraTags || [])))
      throw Error(t('verifySolutionTagsMismatch', solution.name));
  }
  const seen = new Set(), solutionNames = new Set(expectedSolutions), testIndices = new Set(invocation.tests.map(Number));
  const mainNames = new Set(plan.solutions.filter(solution => solution.tag === 'MA').map(solution => solution.name));
  for (const run of detail.runs) {
    if (!solutionNames.has(run.solution) || !testIndices.has(Number(run.test)))
      throw Error(t('verifyInvocationCoverage'));
    const key = JSON.stringify([run.solution, Number(run.test)]);
    if (seen.has(key)) throw Error(t('verifyInvocationCoverage'));
    seen.add(key);
    if (run.violateTag === true || ['CE','FL'].includes(run.verdict) ||
        (mainNames.has(run.solution) &&
          terminalVerdicts.has(run.verdict) && run.verdict !== 'OK'))
      throw Error(t('verifyRunFailed', run.solution, run.test, run.verdict, run.comment || ''));
    if (run.violateTag !== false) throw Error(t('verifyInvalidResponse'));
    if (['NO','TS'].includes(run.verdict)) return null;
    if (!terminalVerdicts.has(run.verdict)) throw Error(t('verifyInvalidResponse'));
  }
  if (seen.size !== expectedSolutions.length * plan.tests.length) return null;
  return {invocationId:invocation.id, solutions:expectedSolutions.length, tests:plan.tests.length, runs:seen.size};
}

export async function verifyProblem({api, id, plan, archive, checkpoint = null,
    save = async () => {}, emit = async () => {},
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), pollMs = 5000, maxPolls = 360}) {
  const revision = await currentRevision(api, id);
  if (checkpoint && (checkpoint.problemId !== id || checkpoint.revision !== revision))
    throw Error(t('verifyRevisionChanged'));
  let state = checkpoint;
  if (!state) {
    const before = packages(await api.problem('packages', id));
    state = {problemId:id, revision, stage:'launching', packageId:null, beforeIds:before.map(item => Number(item.id))};
    // Persist before launching: losing the response must not start a second build.
    await save(state);
    await emit(t('verifyBuildStarting'));
    const started = await api.problem('buildPackage', id, {full:'false', verify:'true'});
    if (started != null && (!validId(started.id) || Number(started.revision) !== revision ||
        state.beforeIds.includes(Number(started.id)))) throw Error(t('verifyInvalidResponse'));
    state = {...state, stage:'polling', packageId:started ? Number(started.id) : null};
    await save(state);
  }
  if (!Array.isArray(state.beforeIds) || !['launching','polling','verified'].includes(state.stage))
    throw Error(t('verifyInvalidCheckpoint'));

  for (let poll = 0; poll < maxPolls; poll++) {
    const listed = packages(await api.problem('packages', id));
    let pkg;
    if (state.packageId != null) {
      pkg = listed.find(item => Number(item.id) === state.packageId);
      if (!pkg || Number(pkg.revision) !== revision) throw Error(t('verifyPackageMissing'));
    } else {
      const candidates = listed.filter(item => Number(item.revision) === revision && !state.beforeIds.includes(Number(item.id)));
      if (candidates.length > 1) throw Error(t('verifyAmbiguousBuild'));
      pkg = candidates[0];
      if (pkg) {
        state = {...state, stage:'polling', packageId:Number(pkg.id)};
        await save(state);
      }
    }
    if (pkg?.state === 'FAILED') throw Error(t('verifyBuildFailed', pkg.id, pkg.comment || ''));
    if (pkg?.state === 'READY') {
      // Tag violations not associated with a specific run appear only here.
      if (String(pkg.comment || '').trim()) throw Error(t('verifyBuildComment', pkg.id, pkg.comment));
      const invocations = await api.problem('invocations', id, {packageId:pkg.id});
      if (!Array.isArray(invocations) || invocations.some(item => Number(item.packageId) !== Number(pkg.id) ||
          !validId(item.id) || item.testset !== 'tests') || invocations.length > 1)
        throw Error(t('verifyInvalidResponse'));
      if (invocations.length) {
        const detail = await api.problem('invocation', id, {invocationId:invocations[0].id});
        if (Number(detail?.invocation?.id) !== Number(invocations[0].id)) throw Error(t('verifyInvalidResponse'));
        const result = checkInvocation(detail, pkg, plan);
        if (result) {
          await emit(t('verifyBuiltDescriptor'));
          const blob = await api.problem('package', id, {packageId:pkg.id, type:'standard'}, {binary:true});
          await verifyBuiltDescriptor(await ZipArchive.fromFile(blob), plan, archive);
          if (await currentRevision(api, id) !== revision) throw Error(t('verifyRevisionChanged'));
          const final = packages(await api.problem('packages', id)).find(item => Number(item.id) === Number(pkg.id));
          if (!final || final.state !== 'READY' || Number(final.revision) !== revision || String(final.comment || '').trim())
            throw Error(t('verifyInvalidResponse'));
          const report = {state:'verified', revision, packageId:Number(pkg.id), ...result};
          await save({...state, stage:'verified', report});
          await emit(t('verifySucceeded', pkg.id, result.runs));
          return report;
        }
      }
    }
    await emit(t('verifyWaiting', pkg?.id || '-', pkg?.state || 'PENDING'));
    if (poll + 1 < maxPolls) await sleep(pollMs);
  }
  throw Error(t('verifyIncomplete', state.packageId || '-'));
}
