import { t } from '../i18n.js';
export async function readTarget(api, id, plan) {
  const listed = await api.call('problems.list', { id });
  if (!Array.isArray(listed)) throw Error(t('polygonImportInvalidResponseFromPolygonProblemList'));
  const entry = listed.find(problem => String(problem.id) === String(id) && !problem.deleted);
  if (!entry) throw Error(t('polygonImportCannotAccessProblem', id));
  if (!['WRITE', 'OWNER'].includes(entry.accessType)) {
    throw Error(t('polygonImportNoWriteAccessToProblem', id));
  }

  const [tests, files, solutions, statements, statementResources, stresses] = await Promise.all([
    api.problem('tests', id, { testset:'tests', noInputs:String(!plan.tests.some(test => test.method === 'manual')) }),
    api.problem('files', id),
    api.problem('solutions', id),
    api.problem('statements', id),
    api.problem('statementResources', id),
    api.problem('stresses', id)
  ]);

  if (!Array.isArray(tests) || !Array.isArray(stresses) || !files ||
      !['sourceFiles','resourceFiles','auxFiles'].every(key => Array.isArray(files[key])) ||
      !Array.isArray(solutions) || !statements ||
      !Array.isArray(statementResources) || statementResources.some(f =>
        !f || typeof f.name !== 'string' || !f.name)) {
    throw Error(t('polygonImportCouldNotReadAllExistingProblemData'));
  }
  if (Array.isArray(stresses) && stresses.length) {
    throw Error(t('polygonImportStressTestsPresent'));
  }

  const [validatorTests, checkerTests] = await Promise.all([
    plan.validatorTests.length ? api.problem('validatorTests', id) : Promise.resolve([]),
    plan.checkerTests.length ? api.problem('checkerTests', id) : Promise.resolve([])
  ]);
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
