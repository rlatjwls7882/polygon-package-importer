import { t } from '../i18n.js';
import { orderGroups } from '../package/groups.js';
import { sameTagList } from './compare.js';
import { syncStatements, deleteStatementResources } from './statements.js';
import { syncFiles, deleteObsoleteFiles } from './files.js';
import { syncInfo, syncJudges, syncJudgeTests, verifyJudging } from './judging.js';
import { configureScoring, readRemoteGroups, prepareGroups, syncGroups } from './groups.js';
import { syncTests, verifyTests } from './tests.js';

export async function syncPackage({api, id, plan, archive, target = null, read, write, skip}) {
  // Polygon permits only one MA solution. Reject ambiguous packages before
  // any writes, rather than leaving a partially updated working copy.
  if (plan.solutions.filter(s => s.tag === 'MA').length > 1)
    throw Error(t('syncZipContainsMultipleMainSolutions'));
  if (new Set(plan.solutions.map(s => s.name)).size !== plan.solutions.length)
    throw Error(t('syncZipContainsSolutionsWithDuplicateNames'));
  if (target && !Array.isArray(target.statementResources))
    throw Error(t('syncOverwriteStoppedCouldNotReadExistingStatement'));

  orderGroups(plan.groups);

  let mutations = 0, testMutations = 0, skipped = 0;
  const apply = async (label, fn, isTest = false) => {
    // Mark mutation before sending; timeouts/unknown server errors may have committed.
    mutations++;
    if (isTest) testMutations++;
    return write(label, fn);
  };
  const unchanged = label => {skipped++; skip?.(label);};
  const existing = !!target;
  const [currentInfo, currentChecker, currentValidator, currentInteractor, currentTags] =
    existing ? await Promise.all([
      read(t('syncComparingTimeAndMemoryLimits'), () => api.problem('info', id)),
      plan.checker ? read(t('syncComparingChecker'), () => api.problem('checker', id)) : Promise.resolve(null),
      plan.validator ? read(t('syncComparingValidator'), () => api.problem('validator', id)) : Promise.resolve(null),
      plan.interactor ? read(t('syncComparingInteractor'), () => api.problem('interactor', id)) : Promise.resolve(null),
      read(t('syncComparingTags'), () => api.problem('viewTags', id))
    ]) : [null, null, null, null, []];

  const context = {api, id, plan, archive, target, read, apply, unchanged};
  let currentGroups = target && (plan.groups.length || target.tests.some(test => test.group)) ?
    await readRemoteGroups(context) : [];
  await syncInfo(context, currentInfo);
  await syncStatements(context);
  await syncFiles(context);
  await syncJudges(context, {currentChecker, currentValidator, currentInteractor});
  await prepareGroups(context, currentGroups);
  await configureScoring(context);
  if (target && plan.groups.length && !target.tests.some(test => test.group)) {
    // Enabling groups can reveal metadata hidden in the previous snapshot.
    currentGroups = await readRemoteGroups(context);
    await prepareGroups(context, currentGroups);
  }
  context.beforeReplacingTests = () => prepareGroups(context, currentGroups, true);
  await syncTests(context);
  await syncGroups(context);
  await syncJudgeTests(context);
  // Old generator files cannot be removed while the previous script uses them.
  await deleteObsoleteFiles(context);
  if (!existing || !sameTagList(currentTags, plan.tags))
    await apply(t('syncSavingTags'), () => api.problem('saveTags', id, {tags:plan.tags.join(',')}));
  else unchanged(t('syncTags'));

  await verifyTests(context, testMutations);
  if (mutations > 0) await verifyJudging(context);
  await deleteStatementResources(context);
  return {mutations, testMutations, skipped};
}
