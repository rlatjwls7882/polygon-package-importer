import { t } from '../i18n.js';

// solutions() has no documented getter for extra tags. Reconcile the known
// testset/group scopes explicitly; do not invent a "no changes" result.
export async function clearObsoleteSolutionTags(context, groups) {
  const {api, id, plan, target, apply} = context;
  if (!target) return;

  const cleared = context.clearedExtraTags ||= new Set();
  const existing = new Set(target.solutions.map(solution => solution.name));
  const scopes = [{testset:'tests'}, ...groups.map(group => ({testGroup:group.name}))];
  for (const solution of plan.solutions) {
    if (!existing.has(solution.name) || !Array.isArray(solution.extraTags)) continue;
    for (const scope of scopes) {
      const key = Object.keys(scope)[0];
      const token = JSON.stringify([solution.name, key, scope[key]]);
      if (cleared.has(token) || solution.extraTags.some(tag => tag[key] === scope[key])) continue;
      await apply(t('formatClearExtraTag', solution.name, scope[key]),
        () => api.problem('editSolutionExtraTags', id, {name:solution.name, ...scope, remove:'true'}));
      cleared.add(token);
    }
  }
}

export async function syncSolutionTags({api, id, plan, apply}) {
  for (const solution of plan.solutions) for (const extra of solution.extraTags || []) {
    await apply(t('formatSaveExtraTag', solution.name, extra.testGroup || extra.testset),
      () => api.problem('editSolutionExtraTags', id, {name:solution.name, ...extra, remove:'false'}));
  }
}
