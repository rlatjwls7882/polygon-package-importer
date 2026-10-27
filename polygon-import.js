import { t } from './i18n.js';
import { ZipArchive } from './zip.js';
import { loadPolygonPackage } from './model.js';
import { syncPackage } from './sync.js';

export async function readTarget(api, id, plan) {
  const listed = await api.call('problems.list', { id });
  if (!Array.isArray(listed)) throw Error(t('polygonImportInvalidResponseFromPolygonProblemList'));
  const entry = listed.find(problem => String(problem.id) === String(id) && !problem.deleted);
  if (!entry) throw Error(t('polygonImportCannotAccessProblem', id));
  if (!['WRITE', 'OWNER'].includes(entry.accessType)) {
    throw Error(t('polygonImportNoWriteAccessToProblem', id));
  }

  const [tests, files, solutions, statements, statementResources, stresses] = await Promise.all([
    api.problem('tests', id, { testset:'tests', noInputs:'false' }),
    api.problem('files', id),
    api.problem('solutions', id),
    api.problem('statements', id),
    api.problem('statementResources', id),
    api.problem('stresses', id)
  ]);

  if (!Array.isArray(tests) || !files || !Array.isArray(solutions) || !statements ||
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

function assertCurrentTarget(before, listed) {
  const after = Array.isArray(listed) && listed.find(p =>
    String(p.id) === String(before.id) && !p.deleted);
  if (!after || !['WRITE', 'OWNER'].includes(after.accessType) ||
      String(before.revision) !== String(after.revision) ||
      String(before.workingCopyRevision ?? '') !== String(after.workingCopyRevision ?? '') ||
      !!before.modified !== !!after.modified) {
    throw Error(t('polygonImportTargetChanged'));
  }
}

export async function executeImport({job, api, onProgress = async () => {}, onCreated = async () => {}}) {
  if (!job || !job.file || !['create','replace'].includes(job.mode)) {
    throw Error(t('polygonImportInvalidImportJob'));
  }
  if (job.mode === 'replace' && !/^[1-9]\d{0,11}$/.test(String(job.problemId))) {
    throw Error(t('polygonImportEnterAValidPolygonProblemId'));
  }

  let id = null;
  let changed = false;
  const emit = (message, progress = null) => onProgress({message, progress});
  await emit(t('polygonImportAnalyzingZip'));
  const archive = await ZipArchive.fromFile(job.file);
  const plan = await loadPolygonPackage(archive);
  if (plan.unsupported.length)
    throw Error(t('polygonImportUnsupportedPackage', plan.unsupported.join('; ')));

  const step = async (label, task) => {
    await emit(label);
    return task();
  };

  let current = null;
  let result = null;
  try {
    if (job.mode === 'replace') {
      id = Number(job.problemId);
      current = await step(t('polygonImportReadingProblem', id), () => readTarget(api, id, plan));
      const latest = await step(t('polygonImportCheckingProblemRevision'),
        () => api.call('problems.list', {id}));
      assertCurrentTarget(current, latest);
    } else {
      const created = await step(t('polygonImportCreatingNewPolygonProblem'),
        () => api.call('problem.create', {name:plan.name}));
      id = Number(created?.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw Error(t('polygonImportNewProblemResponseDidNotContainA'));
      }
      changed = true;
      await onCreated(id);
    }

    result = await syncPackage({
      api, id, plan, archive, target:current,
      read:(label, task) => step(label, task),
      write:(label, task) => {
        changed = true;
        return step(label, task);
      }
    });

    let committed = false;
    if (job.commit && (changed || !!current?.modified)) {
      const commit = await step(t('polygonImportCommittingChanges'),
        () => api.problem('commitChanges', id,
          {minorChanges:'true', message:'Import from Polygon ZIP Uploader'}));
      if (!commit || commit.conflictOccurred ||
          (commit.committed !== true && commit.message !== 'No changes')) {
        throw Error(t('polygonImportCouldNotVerifyCommitResult'));
      }
      committed = true;
    }

    const details = t('polygonImportChangesSkipped', result.mutations, result.skipped);
    await emit(t('polygonImportProblemComplete', id, details), 100);
    return {id, name:plan.name, committed, ...result};
  } catch (error) {
    error.partial = changed;
    error.problemId = id;
    throw error;
  }
}
