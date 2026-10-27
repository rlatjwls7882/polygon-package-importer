import { t } from '../i18n.js';
import { ZipArchive } from '../package/zip.js';
import { checkInvocation } from './verification/invocation.js';
import { currentRevision, packages, validId } from './verification/packages.js';
import { verifyBuiltDescriptor } from './verification/descriptor.js';

export async function verifyProblem({api, id, plan, archive, checkpoint = null,
    save = async () => {}, emit = async () => {},
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), pollMs = 5000, maxPolls = 360}) {
  // Decoded files are no longer needed while the server is building. Keep
  // only the compressed source; descriptor verification may read it again.
  archive.clearCache?.();
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
      if (invocations.length && (invocations[0].status === 'ABORTED' || invocations[0].violateTag === true))
        throw Error(t('verifyInvocationFailed', invocations[0].id));
      if (invocations.length && !['PENDING','RUNNING','FINISHED'].includes(invocations[0].status))
        throw Error(t('verifyInvalidResponse'));
      // The summary is enough while running; defer the potentially huge
      // solution × test result body until execution has actually finished.
      if (invocations.length && invocations[0].status === 'FINISHED') {
        const detail = await api.problem('invocation', id, {invocationId:invocations[0].id});
        if (Number(detail?.invocation?.id) !== Number(invocations[0].id)) throw Error(t('verifyInvalidResponse'));
        const result = checkInvocation(detail, pkg, plan);
        if (result) {
          await emit(t('verifyBuiltDescriptor'));
          const blob = await api.problem('package', id, {packageId:pkg.id, type:'standard'}, {binary:true});
          const built = await ZipArchive.fromFile(blob);
          try { await verifyBuiltDescriptor(built, plan, archive); }
          finally { built.dispose(); archive.clearCache?.(); }
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
