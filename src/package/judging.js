import { t } from '../i18n.js';
import { CHILD, CHILDREN, TEXT, ATTR } from './xml.js';
export function readJudging(root) {
  const judging = CHILD(root, 'judging');
  if (!judging) throw Error(t('modelMissingJudgingElementInProblemXml'));
  const testsets = CHILDREN(judging, 'testset');
  if (testsets.length !== 1 || ATTR(testsets[0], 'name') !== 'tests')
    throw Error(t('modelUnsupportedTestsets'));
  const ts = testsets[0];
  const tl = Number(TEXT(ts, 'time-limit') || 1000);
  const ml0 = Number(TEXT(ts, 'memory-limit') || 256 * 1024 * 1024);
  const ml = ml0 > 1024 ? ml0 / (1024 * 1024) : ml0;
  if (!Number.isInteger(tl) || tl < 250 || tl > 15000 || tl % 50 || !Number.isInteger(ml) || ml < 4 || ml > 1024)
    throw Error(t('modelUnsupportedTimeMemoryLimitsMsMb', tl, ml));
  const info = { timeLimit: tl, memoryLimit: ml,
    inputFile: ATTR(judging, 'input-file') || 'stdin', outputFile: ATTR(judging, 'output-file') || 'stdout',
    interactive: !!CHILD(CHILD(root, 'assets'), 'interactor') };

  return {info, testset:ts};
}
