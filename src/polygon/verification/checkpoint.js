import { t } from '../../i18n.js';

const id = value => Number.isSafeInteger(value) && value > 0;

// History is necessary only until the newly launched package is identified.
// Never retain caller-owned history in pinned checkpoints or trust cached reports.
export function restoreCheckpoint(value, problemId) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.problemId !== problemId || !id(value.revision) ||
      !['launching','polling','verified'].includes(value.stage) ||
      !Array.isArray(value.beforeIds) || value.beforeIds.some(value => !id(value)) ||
      new Set(value.beforeIds).size !== value.beforeIds.length ||
      (value.packageId != null && !id(value.packageId)) ||
      (value.stage === 'launching' && value.packageId != null) ||
      (value.stage === 'verified' && value.packageId == null) ||
      (value.packageId != null && value.beforeIds.includes(value.packageId)))
    throw Error(t('verifyInvalidCheckpoint'));
  return {problemId, revision:value.revision, stage:value.stage,
    packageId:value.packageId ?? null, beforeIds:value.packageId == null ? [...value.beforeIds] : []};
}

export function pinCheckpoint(state, packageId) {
  if (!id(packageId) || state.beforeIds.includes(packageId)) throw Error(t('verifyInvalidResponse'));
  return {problemId:state.problemId, revision:state.revision, stage:'polling', packageId, beforeIds:[]};
}
