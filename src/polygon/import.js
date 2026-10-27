import { verifyProblem } from './verify.js';
import { t } from '../i18n.js';
import { ZipArchive } from '../package/zip.js';
import { loadPolygonPackage } from '../package/load.js';
import { syncPackage } from './sync.js';
import { readTarget, assertCurrentTarget } from './target.js';

export async function executeImport({job, api, onProgress = async () => {}, onCreated = async () => {},
    onCheckpoint = async () => {}, verificationOptions = {}}) {
  if (!job || !job.file || !['create','replace'].includes(job.mode)) {
    throw Error(t('polygonImportInvalidImportJob'));
  }
  if (job.mode === 'replace' && !/^[1-9]\d{0,11}$/.test(String(job.problemId))) {
    throw Error(t('polygonImportEnterAValidPolygonProblemId'));
  }

  if (job.verify && !job.commit) throw Error(t('verifyRequiresCommit'));
  if (job.verification && (!job.verify || job.mode !== 'replace')) throw Error(t('verifyInvalidCheckpoint'));

  let id = null, committed = false;
  let changed = false;
  const emit = (message, progress = null, stage = 'uploading') => onProgress({message, progress, stage, committed});
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
    if (job.verification) {
      id = Number(job.problemId);
      committed = true;
      const verification = await verifyProblem({api, id, plan, archive, checkpoint:job.verification,
        save:onCheckpoint, emit:message => emit(message, null, 'verifying'), ...verificationOptions});
      await emit(t('verifySucceeded', verification.packageId, verification.runs), 100, 'verified');
      return {id, name:plan.name, committed:true, mutations:0, skipped:0, verification};
    }
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

    let verification = {state:'not-run'};
    if (job.verify) {
      verification = await verifyProblem({api, id, plan, archive, save:onCheckpoint,
        emit:message => emit(message, null, 'verifying'), ...verificationOptions});
    }
    const details = t('polygonImportChangesSkipped', result.mutations, result.skipped);
    await emit(t('polygonImportProblemComplete', id, details), 100, job.verify ? 'verified' : 'uploaded');
    return {id, name:plan.name, committed, verification, ...result};
  } catch (error) {
    error.partial = changed || committed;
    error.committed = committed;
    error.problemId = id;
    throw error;
  }
}
