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
  if (!Array.isArray(value) || value.some(item => !item || !validId(item.id) || !validId(item.revision) ||
      !['PENDING','RUNNING','READY','FAILED'].includes(item.state) ||
      (item.type != null && !['standard','linux','windows'].includes(item.type))))
    throw Error(t('verifyInvalidResponse'));
  const builds = new Map();
  for (const item of value) {
    const id = Number(item.id), previous = builds.get(id);
    if (!previous) builds.set(id, {selected:item, types:new Set([item.type])});
    else {
      // Full builds have one row per format, all sharing the same build ID.
      // Only the standard artifact is used for descriptor verification.
      if (Number(previous.selected.revision) !== Number(item.revision) ||
          item.type == null || previous.types.has(undefined) || previous.types.has(null) || previous.types.has(item.type))
        throw Error(t('verifyInvalidResponse'));
      previous.types.add(item.type);
      if (item.type === 'standard') previous.selected = item;
    }
  }
  return [...builds.values()].map(build => build.selected);
}

export const verifiedComment = value => /^Package created in \d+ ms with verification$/.test(String(value || '').trim());
export const successfulComment = value => !String(value || '').trim() || verifiedComment(value);
