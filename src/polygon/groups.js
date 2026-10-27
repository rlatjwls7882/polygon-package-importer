import { t } from '../i18n.js';
import { str } from './compare.js';

export async function configureScoring({api, id, plan, target, apply}) {
  const desiredGroups = plan.groups.length > 0 || plan.tests.some(t => t.group);
  const currentGroups = (target?.tests || []).some(t => t.group);
  if (desiredGroups && (!target || !currentGroups))
    await apply(t('syncEnablingTestGroups'), () => api.problem('enableGroups', id, {testset:'tests', enable:'true'}));
  else if (!desiredGroups && currentGroups)
    await apply(t('syncDisablingUnusedTestGroups'),
      () => api.problem('enableGroups', id, {testset:'tests', enable:'false'}));

  const wantedPoints = plan.tests.some(t => t.points !== null);
  const existingPoints = (target?.tests || []).some(t => t.points != null);
  if (wantedPoints !== existingPoints || (wantedPoints && !target))
    await apply(t('syncConfiguringTestPoints'), () => api.problem('enablePoints', id, {enable:String(wantedPoints)}));
}

export async function syncGroups({api, id, plan, target, read, apply, unchanged}) {
  if (plan.groups.length) {
    const current = target ? await read(t('syncComparingTestGroupPolicy'),
      () => api.problem('viewTestGroup', id, {testset:'tests'})) : [];
    for (const group of plan.groups) {
      const previous = (Array.isArray(current) ? current : []).find(x => x.name === group.name);
      const depends = group.dependencies.join(',');
      const priorDepends = Array.isArray(previous?.dependencies) ?
        previous.dependencies.join(',') : str(previous?.dependencies);
      if (previous && previous.pointsPolicy === group.pointsPolicy &&
          previous.feedbackPolicy === group.feedbackPolicy && priorDepends === depends)
        unchanged(t('syncTestGroup', group.name));
      else await apply(t('syncConfiguringTestGroup', group.name),
        () => api.problem('saveTestGroup', id, {testset:'tests', group:group.name,
          pointsPolicy:group.pointsPolicy, feedbackPolicy:group.feedbackPolicy, dependencies:depends}));
    }
  }
}
