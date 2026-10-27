import { t } from '../i18n.js';
import { CHILD, CHILDREN, ATTR } from './xml.js';

const policy = value => value.replaceAll('-', '_').toUpperCase();
const validName = name => !!name && name === name.trim() && !/[,\x00-\x1f\x7f]/.test(name);

export function readPoints(value, label) {
  // Polygon accepts hundredths, not arbitrary floating-point precision.
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) || Number(value) >= 1e9)
    throw Error(t('packageInvalidPoints', label, value));
  return Number(value);
}

export function orderGroups(groups) {
  const byName = new Map();
  for (const group of groups) {
    if (!validName(group.name) || byName.has(group.name))
      throw Error(t('packageInvalidGroupName', group.name));
    if (!['COMPLETE_GROUP','EACH_TEST'].includes(group.pointsPolicy) ||
        !['NONE','POINTS','ICPC','COMPLETE'].includes(group.feedbackPolicy))
      throw Error(t('packageInvalidGroupPolicy', group.name));
    if (!Array.isArray(group.dependencies) || new Set(group.dependencies).size !== group.dependencies.length)
      throw Error(t('packageInvalidGroupDependencies', group.name));
    byName.set(group.name, group);
  }
  const visiting = new Set(), visited = new Set(), result = [];
  function visit(group) {
    if (visiting.has(group.name)) throw Error(t('packageCyclicGroups', group.name));
    if (visited.has(group.name)) return;
    visiting.add(group.name);
    for (const name of group.dependencies) {
      const dependency = byName.get(name);
      if (!dependency) throw Error(t('packageMissingGroupDependency', group.name, name));
      visit(dependency);
    }
    visiting.delete(group.name);
    visited.add(group.name);
    result.push(group);
  }
  for (const group of groups) visit(group);
  return result;
}

export function readGroups(ts, plan) {
  const elements = CHILDREN(CHILD(ts, 'groups'), 'group');
  plan.groups = elements.map(el => ({
    name:ATTR(el, 'name'),
    feedbackPolicy:policy(ATTR(el, 'feedback-policy', 'complete')),
    pointsPolicy:policy(ATTR(el, 'points-policy', 'complete-group')),
    dependencies:CHILDREN(CHILD(el, 'dependencies'), 'dependency').map(d => ATTR(d, 'group'))
  }));
  orderGroups(plan.groups);
  const byName = new Map(plan.groups.map(group => [group.name, group]));
  const membersByGroup = new Map(plan.groups.map(group => [group.name, []]));
  for (const test of plan.tests) {
    if (test.group && !byName.has(test.group)) throw Error(t('modelATestReferencesAGroupNotDefined'));
    membersByGroup.get(test.group)?.push(test);
  }

  for (let i = 0; i < elements.length; i++) {
    const group = plan.groups[i], element = elements[i];
    const members = membersByGroup.get(group.name);
    // The API creates a group by assigning a test; it cannot create empty groups.
    if (!members.length) throw Error(t('packageEmptyGroup', group.name));
    if (!element.hasAttribute('points')) continue;
    const points = readPoints(ATTR(element, 'points'), group.name);
    if (members.every(test => test.points === null)) {
      if (group.pointsPolicy !== 'COMPLETE_GROUP')
        throw Error(t('packageAmbiguousGroupPoints', group.name));
      // Polygon exports a complete-group score on one member, with zero on the others.
      members.forEach((test, index) => {test.points = index === 0 ? points : 0;});
    } else {
      const total = members.reduce((sum, test) => sum + Math.round((test.points ?? 0) * 100), 0);
      if (total !== Math.round(points * 100)) throw Error(t('packageGroupPointsMismatch', group.name));
    }
  }
  // While points are enabled, omitted scores must not inherit old remote scores.
  if (plan.tests.some(test => test.points !== null))
    for (const test of plan.tests) test.points ??= 0;
}
