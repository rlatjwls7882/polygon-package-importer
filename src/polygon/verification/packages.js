import { t } from '../../i18n.js';
export const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

export async function currentRevision(api, id) {
  const problems = await api.call('problems.list', {id});
  const problem = Array.isArray(problems) && problems.find(problem => Number(problem.id) === id && !problem.deleted);
  if (!problem || !['WRITE','OWNER'].includes(problem.accessType) || problem.modified ||
      !validId(problem.revision) || (problem.workingCopyRevision != null &&
        Number(problem.workingCopyRevision) !== Number(problem.revision)))
    throw Error(t('verifyNeedsCleanRevision'));
  return Number(problem.revision);
}

export function packages(value) {
  if (!Array.isArray(value) || value.some(item => !validId(item.id) || !validId(item.revision) ||
      !['PENDING','RUNNING','READY','FAILED'].includes(item.state)) ||
      new Set(value.map(item => Number(item.id))).size !== value.length)
    throw Error(t('verifyInvalidResponse'));
  return value;
}
