import { ATTR, CHILD, CHILDREN, resolveXmlText } from './xml.js';
import { readJudging } from './judging.js';
import { readStatements } from './statements.js';
import { readAssets } from './assets.js';
import { readExamples } from './examples.js';
import { readTests } from './tests.js';
import { validatePackage } from './validate.js';

export async function loadPolygonPackage(archive) {
  const root = resolveXmlText(await archive.text('problem.xml'));
  const plan = { name: ATTR(root, 'short-name') || 'imported-problem', info: {},
    statements: [], sources: [], resources: [], aux: [], solutions: [], checker: '', validator: '', interactor: '',
    tests: [], groups: [], validatorTests: [], checkerTests: [], tags: [], unsupported: [] };

  const {info, testset} = readJudging(root);
  plan.info = info;
  await readStatements(root, archive, plan);
  await readAssets(root, archive, plan);
  plan.tags = CHILDREN(CHILD(root, 'tags'), 'tag').map(x => ATTR(x, 'value')).filter(Boolean);
  await readTests(root, testset, archive, plan);
  await readExamples(archive, plan);
  await validatePackage(archive, plan);
  return plan;
}
