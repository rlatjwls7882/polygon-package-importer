import { t } from '../i18n.js';
import { restoreCheckpoint, pinCheckpoint } from './verification/checkpoint.js';
import { ZipArchive } from '../package/zip.js';
import { checkInvocation } from './verification/invocation.js';
import { currentRevision, packages, validId, successfulComment } from './verification/packages.js';
import { verifyBuiltDescriptor } from './verification/descriptor.js';

// Keep the potentially large detail response out of the build-ZIP download
// scope. Only the compact verification result survives this function.
async function readInvocation(api, id, invocationId, pkg, plan) {
  const detail = await api.problem('invocation', id, {invocationId});
  if (Number(detail?.invocation?.id) !== Number(invocationId)) throw Error(t('verifyInvalidResponse'));
  return checkInvocation(detail, pkg, plan);
}

export async function verifyProblem({api, id, plan, archive, checkpoint = null,
    save = async () => {}, emit = async () => {},
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), pollMs = 5000, maxPolls = 360, revisionCheckEvery = 12}) {
  // Decoded files are no longer needed while the server is building. Keep
  // only the compressed source; descriptor verification may read it again.
  archive.clearCache?.();
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || !Number.isSafeInteger(revisionCheckEvery) || revisionCheckEvery < 1)
    throw Error(t('verifyInvalidCheckpoint'));
  let state = checkpoint ? restoreCheckpoint(checkpoint, id) : null;
  const revision = await currentRevision(api, id);
  if (state && state.revision !== revision) throw Error(t('verifyRevisionChanged'));
  if (checkpoint?.packageId != null && checkpoint.beforeIds.length) await save(state);
  checkpoint = null;
  if (!state) {
    const before = packages(await api.problem('packages', id));
    state = {problemId:id, revision, stage:'launching', packageId:null, beforeIds:before.map(item => Number(item.id))};
    // Persist before launching: losing the response must not start a second build.
    await save(state);
    await emit(t('verifyBuildStarting'));
    const response = await api.problem('buildPackage', id, {full:'false', verify:'true'});
    const started = response == null ? [] : packages(Array.isArray(response) ? response : [response]);
    if (started.length > 1 || started.some(item => Number(item.revision) !== revision ||
        state.beforeIds.includes(Number(item.id)))) throw Error(t('verifyInvalidResponse'));
    state = started.length ? pinCheckpoint(state, Number(started[0].id)) : {...state, stage:'polling'};
    await save(state);
  }
  let previousIds = state.packageId == null ? new Set(state.beforeIds) : null;
  const assertRevision = async () => {
    if (await currentRevision(api, id) !== revision) throw Error(t('verifyRevisionChanged'));
  };

  for (let poll = 0; poll < maxPolls; poll++) {
    // A changed working copy invalidates this verification. Stop periodically
    // instead of spending the full polling budget on an obsolete revision.
    if (poll > 0 && poll % revisionCheckEvery === 0) await assertRevision();
    const pkg = await readBuild(api, id, state, previousIds);
    if (pkg && state.packageId == null) {
      state = pinCheckpoint(state, Number(pkg.id)); previousIds = null;
      await save(state);
    }
    if (pkg?.state === 'FAILED') throw Error(t('verifyBuildFailed', pkg.id, pkg.comment || ''));
    if (pkg?.state === 'READY') {
      // Tag violations not associated with a specific run appear only here.
      if (!successfulComment(pkg.comment)) throw Error(t('verifyBuildComment', pkg.id, pkg.comment));
      const invocations = await api.problem('invocations', id, {packageId:pkg.id});
      if (!Array.isArray(invocations) || invocations.some(item => Number(item.packageId) !== Number(pkg.id) ||
          !validId(item.id) || item.testset !== 'tests') || invocations.length > 1)
        throw Error(t('verifyInvalidResponse'));
      if (invocations.length && (invocations[0].status === 'ABORTED' || invocations[0].violateTag === true))
        throw Error(t('verifyInvocationFailed', invocations[0].id));
      if (invocations.length && !['PENDING','RUNNING','FINISHED'].includes(invocations[0].status))
        throw Error(t('verifyInvalidResponse'));
      // The summary is enough while running; defer the potentially huge
      // solution × test result body until execution has actually finished.
      if (invocations.length && invocations[0].status === 'FINISHED') {
        await assertRevision(); // Before large run details or the standard ZIP.
        const result = await readInvocation(api, id, invocations[0].id, pkg, plan);
        if (result) {
          await emit(t('verifyBuiltDescriptor'));
          const blob = await api.problem('package', id, {packageId:pkg.id, type:'standard'}, {binary:true});
          const built = await ZipArchive.fromFile(blob);
          try { await verifyBuiltDescriptor(built, plan, archive); }
          finally { built.dispose(); archive.clearCache?.(); }
          await assertRevision();
          const final = packages(await api.problem('packages', id)).find(item => Number(item.id) === Number(pkg.id));
          if (!final || final.state !== 'READY' || Number(final.revision) !== revision || !successfulComment(final.comment))
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

// The full packages() list is temporary; callers retain only the pinned build.
async function readBuild(api, id, state, previousIds) {
  const listed = packages(await api.problem('packages', id));
  if (state.packageId != null) {
    const pkg = listed.find(item => Number(item.id) === state.packageId);
    if (!pkg || Number(pkg.revision) !== state.revision) throw Error(t('verifyPackageMissing'));
    return pkg;
  }
  let found;
  for (const item of listed) if (Number(item.revision) === state.revision && !previousIds.has(Number(item.id))) {
    if (found) throw Error(t('verifyAmbiguousBuild'));
    found = item;
  }
  return found;
}
