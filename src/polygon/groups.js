import { t } from '../i18n.js';
import { orderGroups } from '../package/groups.js';

const dependencies = group => [...group.dependencies].sort().join('\0');

export async function configureScoring({api, id, plan, target, apply}) {
  const currentPercent = target?.packageSnapshot?.checkerPercent;
  const wantedPoints = plan.tests.some(t => t.points != null);
  const existingPoints = (target?.tests || []).some(t => t.points != null);
  // Percent mode has no documented info() getter. Explicitly set/reset it,
  // and verify it again in the built descriptor in full verification mode.
  if (plan.checkerPercent === false && (wantedPoints || existingPoints) && currentPercent !== false)
    await apply(t('formatCheckerPercent'), () => api.problem('enableTreatPointsFromCheckerAsPercent', id, {enable:'false'}));
  const desiredGroups = plan.groups.length > 0 || plan.tests.some(t => t.group);
  const currentGroups = (target?.tests || []).some(t => t.group);
  if (desiredGroups && (!target || !currentGroups))
    await apply(t('syncEnablingTestGroups'), () => api.problem('enableGroups', id, {testset:'tests', enable:'true'}));
  else if (!desiredGroups && currentGroups)
    await apply(t('syncDisablingUnusedTestGroups'),
      () => api.problem('enableGroups', id, {testset:'tests', enable:'false'}));

  if (wantedPoints !== existingPoints || (wantedPoints && !target))
    await apply(t('syncConfiguringTestPoints'), () => api.problem('enablePoints', id, {enable:String(wantedPoints)}));
  if (plan.checkerPercent === true && (currentPercent !== true || wantedPoints !== existingPoints))
    await apply(t('formatCheckerPercent'), () => api.problem('enableTreatPointsFromCheckerAsPercent', id, {enable:'true'}));
  return !!target && ((desiredGroups && !currentGroups) || (wantedPoints && !existingPoints));
}

export async function readRemoteGroups({api, id, read}) {
  const groups = await read(t('syncComparingTestGroupPolicy'),
    () => api.problem('viewTestGroup', id, {testset:'tests'}));
  if (!Array.isArray(groups) || groups.some(group => !group || typeof group.name !== 'string' ||
      !Array.isArray(group.dependencies) || group.dependencies.some(name => typeof name !== 'string')))
    throw Error(t('syncInvalidGroupResponse'));
  orderGroups(groups);
  return groups;
}

export async function prepareGroups({api, id, plan, apply}, current, rebuilding = false) {
  const wanted = new Map(plan.groups.map(group => [group.name, group]));
  for (const group of current) {
    const desired = wanted.get(group.name);
    // Clear changed edges first: reversing A->B to B->A would otherwise create
    // a temporary cycle; removed groups may still be referenced by old edges.
    if (group.dependencies.length && (rebuilding || !desired || dependencies(group) !== dependencies(desired))) {
      await apply(t('syncClearGroupDependencies', group.name),
        () => api.problem('saveTestGroup', id, {testset:'tests', group:group.name, dependencies:''}));
      group.dependencies = [];
    }
  }
}

function sameGroup(actual, wanted) {
  return actual && actual.pointsPolicy === wanted.pointsPolicy &&
    actual.feedbackPolicy === wanted.feedbackPolicy && dependencies(actual) === dependencies(wanted);
}

export async function syncGroups(context, snapshot = null) {
  const {api, id, plan, apply, unchanged} = context;
  if (!plan.groups.length) return;
  // Tests create groups, so read again after uploading/recreating the tests.
  const current = new Map((snapshot ?? await readRemoteGroups(context)).map(group => [group.name, group]));
  let changed = false;
  for (const group of orderGroups(plan.groups)) {
    const previous = current.get(group.name);
    if (!previous) throw Error(t('syncMissingCreatedGroup', group.name));
    if (sameGroup(previous, group)) unchanged(t('syncTestGroup', group.name));
    else {
      changed = true;
      await apply(t('syncConfiguringTestGroup', group.name),
        () => api.problem('saveTestGroup', id, {testset:'tests', group:group.name,
          pointsPolicy:group.pointsPolicy, feedbackPolicy:group.feedbackPolicy,
          dependencies:group.dependencies.join(',')}));
    }
  }
  if (changed) {
    const saved = new Map((await readRemoteGroups(context)).map(group => [group.name, group]));
    if (plan.groups.some(group => !sameGroup(saved.get(group.name), group)))
      throw Error(t('syncGroupMismatch'));
  }
}
