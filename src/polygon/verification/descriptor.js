import { t } from '../../i18n.js';
import { CHILD, CHILDREN, ATTR, resolveXmlText } from '../../package/xml.js';
import { readJudging } from '../../package/judging.js';
import { readAssets } from '../../package/assets.js';
import { readGroups, readPoints } from '../../package/groups.js';
import { canonicalExtraTags, canonicalResource } from '../../package/metadata.js';

import { sameText } from '../../package/text.js';

// The built descriptor is the read-back source for flags/extra tags that do not
// have documented getters on info()/solutions(). It belongs to a pinned build.
export async function verifyBuiltDescriptor(built, plan, original) {
  const root = resolveXmlText(await built.text('problem.xml'));
  const judging = readJudging(root);
  if (judging.checkerPercent !== !!plan.checkerPercent ||
      ['interactive','runTwice','interactiveSecondRun'].some(key => !!judging.info[key] !== !!plan.info[key]))
    throw Error(t('verifyDescriptorMismatch', 'judging'));
  for (const key of ['timeLimit','memoryLimit','inputFile','outputFile'])
    if (judging.info[key] !== plan.info[key]) throw Error(t('verifyDescriptorMismatch', key));
  const tests = CHILDREN(CHILD(judging.testset, 'tests'), 'test').map((node, i) => ({
    index:i + 1, method:ATTR(node,'method'), sample:ATTR(node,'sample') === 'true',
    cmd:ATTR(node,'cmd'), description:ATTR(node,'description'), group:ATTR(node,'group'),
    points:node.hasAttribute('points') ? readPoints(ATTR(node,'points'), String(i + 1)) : null
  }));
  const scoring = {tests, groups:[]};
  readGroups(judging.testset, scoring);
  const groupShape = groups => groups.map(group => ({...group, dependencies:[...group.dependencies].sort()}))
    .sort((a,b) => a.name.localeCompare(b.name));
  if (JSON.stringify(groupShape(scoring.groups)) !== JSON.stringify(groupShape(plan.groups)) ||
      tests.length !== plan.tests.length || tests.some((test, i) => {
        const desired = plan.tests[i];
        return test.index !== desired.index || test.method !== desired.method || test.sample !== desired.sample ||
          test.group !== desired.group || test.points !== desired.points || test.description !== desired.description ||
          (test.method === 'generated' && test.cmd !== desired.cmd);
      })) throw Error(t('verifyDescriptorMismatch', 'tests/groups'));
  const saved = {sources:[],resources:[],aux:[],solutions:[],unsupported:[],checker:'',validator:'',interactor:''};
  await readAssets(root, built, saved);
  if (saved.unsupported.length) throw Error(t('verifyDescriptorMismatch', 'assets'));
  for (const kind of ['checker','validator','interactor']) {
    const canonical = value => String(value || '').replace(/^(std::.*)\.cpp$/, '$1');
    if (canonical(saved[kind]) !== canonical(plan[kind])) throw Error(t('verifyDescriptorMismatch', kind));
  }
  for (const kind of ['sources','solutions','resources','aux']) {
    const actual = new Map(saved[kind].map(file => [file.name, file]));
    for (const file of plan[kind]) {
      const value = actual.get(file.name);
      if (!value || (file.sourceType && file.sourceType !== value.sourceType))
        throw Error(t('verifyDescriptorMismatch', file.name));
      if (kind === 'solutions' && (file.tag !== value.tag ||
          JSON.stringify(canonicalExtraTags(file.extraTags || [])) !== JSON.stringify(canonicalExtraTags(value.extraTags || []))))
        throw Error(t('verifyDescriptorMismatch', file.name));
      if (kind === 'resources' && JSON.stringify(canonicalResource(file.resourceAdvancedProperties)) !==
          JSON.stringify(canonicalResource(value.resourceAdvancedProperties)))
        throw Error(t('verifyDescriptorMismatch', file.name));
      if (!sameText(await built.text(value.path), await original.text(file.path)))
        throw Error(t('verifyDescriptorMismatch', file.name));
    }
  }
}
