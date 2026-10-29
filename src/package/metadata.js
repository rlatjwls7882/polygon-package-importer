import { t } from '../i18n.js';
import { ATTR, CHILD, CHILDREN } from './xml.js';

export const TAGS = {
  main:'MA', accepted:'OK', rejected:'RJ', 'wrong-answer':'WA',
  'time-limit-exceeded':'TL', 'time-limit-exceeded-or-accepted':'TO',
  'time-limit-exceeded-or-memory-limit-exceeded':'TM', 'presentation-error':'PE',
  'memory-limit-exceeded':'ML', 'do-not-run':'NR', 'runtime-error':'RE', failed:'RE'
};

// Generic standard labels are not Polygon server compiler IDs. Resolve only
// these explicit aliases; never infer a version from filenames or retry a
// rejected concrete ID with a different compiler.
const API_SOURCE_TYPES = new Map([
  ['cpp.g++20', 'cpp.gcc13-64-winlibs-g++20'],
  ['cpp.g++23', 'cpp.gcc14-64-msys2-g++23']
]);
export function apiSourceType(value) { return API_SOURCE_TYPES.get(value) ?? value; }

export function readSourceType(element) {
  const value = ATTR(element, 'type');
  if (!value) return undefined;
  // Keep the package identifier unchanged. Only the API boundary resolves
  // the explicit generic aliases above; concrete native IDs remain exact.
  if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/.test(value))
    throw Error(t('formatInvalidSourceType', value));
  return value;
}

export function readResourceProperties(element) {
  const stages = CHILD(element, 'stages'), assets = CHILD(element, 'assets');
  if (!element.hasAttribute('for-types') && !stages && !assets) return null;
  const forTypes = ATTR(element, 'for-types').split(/[;:]/).map(value => value.trim());
  const stageNames = CHILDREN(stages, 'stage').map(node => ATTR(node, 'name').toUpperCase());
  const assetNames = CHILDREN(assets, 'asset').map(node => ATTR(node, 'name').toUpperCase());
  // These are the combinations documented by saveFile, not all combinations
  // that can exist in a package. Refuse the rest before creating a problem.
  if (forTypes.some(value => !/^[A-Za-z0-9*?][A-Za-z0-9.+_*?-]{0,127}$/.test(value)) ||
      stageNames.length !== 1 || stageNames[0] !== 'COMPILE' ||
      assetNames.length !== 1 || assetNames[0] !== 'SOLUTION' ||
      (element.hasAttribute('main') && ATTR(element, 'main') !== 'false'))
    throw Error(t('formatUnsupportedResourceProperties', ATTR(element, 'path')));
  return {forTypes:[...new Set(forTypes)].sort().join(';'), stages:['COMPILE'], assets:['SOLUTION']};
}

export function canonicalResource(value) {
  if (!value) return null;
  if (value.main === true || !Array.isArray(value.stages) || !Array.isArray(value.assets) ||
      typeof value.forTypes !== 'string') return {invalid:true};
  return {forTypes:[...new Set(value.forTypes.split(/[;:]/).map(x => x.trim()))].sort().join(';'),
    stages:[...value.stages].sort(), assets:[...value.assets].sort()};
}

export function apiResource(value) {
  const result = canonicalResource(value);
  if (!result || result.invalid) return result;
  return {...result, forTypes:[...new Set(result.forTypes.split(';').map(apiSourceType))].sort().join(';')};
}

export function readExtraTags(solution) {
  const result = [], scopes = new Set();
  for (const node of CHILDREN(CHILD(solution, 'extra-tags'), 'extra-tag')) {
    const group = ATTR(node, 'group'), testset = ATTR(node, 'testset');
    const tag = TAGS[ATTR(node, 'tag').toLowerCase()];
    const key = group ? 'group:'+group : 'testset:'+testset;
    if (!!group === !!testset || !tag || tag === 'MA' || scopes.has(key))
      throw Error(t('formatInvalidExtraTag', ATTR(CHILD(solution, 'source'), 'path')));
    scopes.add(key);
    result.push({...(group ? {testGroup:group} : {testset}), tag});
  }
  return result;
}

export function canonicalExtraTags(values) {
  return values.map(value => [(value.testGroup ? 'group:' + value.testGroup : 'testset:' + value.testset), value.tag])
    .sort(([a], [b]) => a.localeCompare(b));
}
