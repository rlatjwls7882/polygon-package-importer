import { t } from '../i18n.js';

export async function commitProblem({api, id, revision, verify}) {
  let result;
  try {
    result = await api.problem('commitChanges', id,
      {minorChanges:'true', message:'Import from Polygon ZIP Uploader'});
  } catch (error) {
    // A failed/lost response can follow a successful commit. Never resend it.
    // Only one new clean revision of this existing target can be confirmed.
    const before = Number(revision);
    if (revision != null && Number.isSafeInteger(before) && before >= 0 && before < Number.MAX_SAFE_INTEGER) {
      try {
        const listed = await api.call('problems.list', {id});
        const matches = Array.isArray(listed) ? listed.filter(problem => Number(problem.id) === Number(id)) : [];
        const after = matches.length === 1 && !matches[0].deleted ? matches[0] : null;
        if (after && ['WRITE','OWNER'].includes(after.accessType) && after.modified === false &&
            Number(after.revision) === before + 1 && Number(after.workingCopyRevision) === before + 1) {
          error.committed = true;
          // Confirmation is not verification: the full build/descriptor checks
          // must still succeed before this attempt can report success.
          if (verify) return {recovered:true, revision:before + 1};
          error.message = t('verifyCommitConfirmedNotVerified', before + 1);
        }
      } catch { /* Keep the original commit failure when confirmation fails. */ }
    }
    throw error;
  }
  if (!result || result.conflictOccurred ||
      (result.committed !== true && result.message !== 'No changes'))
    throw Error(t('polygonImportCouldNotVerifyCommitResult'));
  return {recovered:false};
}
