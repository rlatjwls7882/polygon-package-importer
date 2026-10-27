import { testsSnapshot, filesSnapshot, namedSnapshot, statementsSnapshot, judgeTestsSnapshot } from './snapshot.js';
import { t } from '../i18n.js';
export async function readTarget(api, id, plan) {
  const listed = await api.call('problems.list', { id });
  if (!Array.isArray(listed)) throw Error(t('polygonImportInvalidResponseFromPolygonProblemList'));
  const entry = listed.find(problem => String(problem.id) === String(id) && !problem.deleted);
  if (!entry) throw Error(t('polygonImportCannotAccessProblem', id));
  if (!['WRITE', 'OWNER'].includes(entry.accessType)) {
    throw Error(t('polygonImportNoWriteAccessToProblem', id));
  }

  // The transport is already serialized. Check cheap eligibility first and
  // await each read so one failure cannot enqueue large, now-useless payloads.
  const stresses = await api.problem('stresses', id);
  if (!Array.isArray(stresses)) throw Error(t('polygonImportCouldNotReadAllExistingProblemData'));
  if (stresses.length) throw Error(t('polygonImportStressTestsPresent'));
  const extraValidators = await api.problem('extraValidators', id);
  if (!Array.isArray(extraValidators) || extraValidators.length)
    throw Error(t('formatTargetExtraValidators'));

  const files = filesSnapshot(await api.problem('files', id));
  const solutions = namedSnapshot(await api.problem('solutions', id));
  const statementResources = namedSnapshot(await api.problem('statementResources', id));
  const statements = statementsSnapshot(await api.problem('statements', id));
  const validatorTests = judgeTestsSnapshot(await api.problem('validatorTests', id), 'validator');
  const checkerTests = judgeTestsSnapshot(await api.problem('checkerTests', id), 'checker');
  const tests = testsSnapshot(await api.problem('tests', id,
    {testset:'tests', noInputs:String(!plan.tests.some(test => test.method === 'manual'))}));

  return {
    ...entry, tests, files, solutions, statements, statementResources, validatorTests, checkerTests
  };
}

export function assertCurrentTarget(before, listed) {
  const after = Array.isArray(listed) && listed.find(p =>
    String(p.id) === String(before.id) && !p.deleted);
  if (!after || !['WRITE', 'OWNER'].includes(after.accessType) ||
      String(before.revision) !== String(after.revision) ||
      String(before.workingCopyRevision ?? '') !== String(after.workingCopyRevision ?? '') ||
      !!before.modified !== !!after.modified) {
    throw Error(t('polygonImportTargetChanged'));
  }
}
