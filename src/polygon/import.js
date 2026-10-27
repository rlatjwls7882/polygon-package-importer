import { t } from '../i18n.js';
import { ZipArchive } from '../package/zip.js';
import { loadPolygonPackage } from '../package/load.js';
import { syncPackage } from './sync.js';
import { readTarget, assertCurrentTarget } from './target.js';

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
