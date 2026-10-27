import { t } from '../i18n.js';
import { CHILD, CHILDREN, TEXT, ATTR, KIND_DESC } from './xml.js';
const mapVerdict = s => s.replaceAll('-', '_').toUpperCase();

function asIndexPath(pattern, index) {
  if (!pattern) throw Error(t('modelTestPathPatternIsMissing'));
  if (!/^[-\w./%]+$/.test(pattern) || !/%(?:0[1-9]\d?)?d/.test(pattern))
    throw Error(t('modelUnsupportedTestPathPattern', pattern));
  const path = pattern.replace(/%(0([1-9]\d?))?d/, (_, a, width) => String(index).padStart(Number(width) || 0, '0'));
  if (path.includes('%')) throw Error(t('modelUnsupportedTestPathPattern', pattern));
  return path;
}

async function testPath(archive, pattern, index) {
  const path = asIndexPath(pattern, index);
  const candidates = [path, 'files/' + path, 'files/tests/' + path];
  const match = [...new Set(candidates)].find(p => archive.has(p));
  if (!match) throw Error(t('modelMissingTestData', path));
  return match;
}

export async function readTests(root, ts, archive, plan) {
  const assets = CHILD(root, 'assets');
  const xmlTests = CHILDREN(CHILD(ts, 'tests'), 'test');
  const declared = Number(TEXT(ts, 'test-count') || xmlTests.length);
  if (declared !== xmlTests.length || declared > 1000) throw Error(t('modelDeclaredTestCountDiffersOrExceeds1'));
  const pattern = TEXT(ts, 'input-path-pattern') || 'tests/%02d';
  for (let i = 0; i < xmlTests.length; i++) {
    const el = xmlTests[i];
    const method = ATTR(el, 'method');
    if (!['manual', 'generated'].includes(method)) throw Error(t('modelUnsupportedTestMethodTest', method, i+1));
    const test = { index: i + 1, method, description: ATTR(el, 'description'), sample: ATTR(el, 'sample') === 'true',
      group: ATTR(el, 'group'), points: el.hasAttribute('points') ? Number(ATTR(el,'points')) : null, cmd: ATTR(el, 'cmd') };
    const inputCandidate = asIndexPath(pattern, i + 1);
    const inputPath = [inputCandidate, 'files/' + inputCandidate, 'files/tests/' + inputCandidate].find(p => archive.has(p));
    if (method === 'manual') test.path = await testPath(archive, pattern, i + 1);
    else if (!test.cmd && inputPath) {
      // Full packages can contain generated inputs even without reusable commands.
      test.method = 'manual'; test.path = inputPath;
    } else if (!test.cmd || /[\r\n><]/.test(test.cmd) || ATTR(el, 'from-file')) {
      plan.unsupported.push(t('modelTestCannotSafelyRestoreTheGeneratorCommand', i+1));
    }
    if (test.method === 'generated' && !/^[a-zA-Z_][\w./-]*(?:[ \t]+[^\r\n<>]+)*$/.test(test.cmd))
      plan.unsupported.push(t('modelTestUnsupportedGeneratorCommand', i+1, test.cmd));
    if (inputPath) test.path = inputPath;
    const answerPattern = TEXT(ts, 'answer-path-pattern');
    if (answerPattern) {
      const answer = asIndexPath(answerPattern, i + 1);
      test.outputPath = [answer, 'files/' + answer, 'files/tests/' + answer].find(p => archive.has(p));
    }
    if (test.points != null && (!Number.isFinite(test.points) || test.points < 0 || test.points >= 1e9))
      throw Error(t('modelTestInvalidScore', i+1));
    plan.tests.push(test);
  }
  plan.groups = CHILDREN(CHILD(ts, 'groups'), 'group').map(el => ({
    name: ATTR(el, 'name'), feedbackPolicy: mapVerdict(ATTR(el, 'feedback-policy') || 'complete'),
    pointsPolicy: mapVerdict(ATTR(el, 'points-policy') || 'complete-group'),
    dependencies: CHILDREN(CHILD(el, 'dependencies'), 'dependency').map(d => ATTR(d, 'group')).filter(Boolean)
  }));
  if (plan.groups.some(g => !g.name)) throw Error(t('modelTestGroupWithoutAName'));
  if (plan.tests.some(t => t.group && !plan.groups.some(g => g.name === t.group)))
    plan.unsupported.push(t('modelATestReferencesAGroupNotDefined'));

  // Polygon ZIPs may contain separate validator/checker testsets.
  async function parseSpecialTests(desc, kind) {
    const s = CHILD(desc, 'testset');
    if (!s) return [];
    const es = CHILDREN(CHILD(s, 'tests'), 'test');
    if (!es.length) return [];
    const inputs = TEXT(s, 'input-path-pattern');
    const outputs = TEXT(s, 'output-path-pattern');
    const answers = TEXT(s, 'answer-path-pattern');
    const out = [];
    for (let i = 0; i < es.length; i++) {
      const verdict = mapVerdict(ATTR(es[i], 'verdict'));
      if (kind === 'validator' && !['VALID','INVALID'].includes(verdict)) throw Error(t('modelInvalidValidatorTestVerdict'));
      if (kind === 'checker' && !['OK','WRONG_ANSWER','PRESENTATION_ERROR','CRASHED'].includes(verdict)) throw Error(t('modelInvalidCheckerTestVerdict'));
      const inputPath = await testPath(archive, inputs, i+1);
      out.push({ index: i+1, verdict, inputPath,
        ...(kind === 'checker' ? { outputPath: await testPath(archive, outputs, i+1), answerPath: await testPath(archive, answers, i+1) } : {}) });
    }
    return out;
  }
  plan.validatorTests = await parseSpecialTests(KIND_DESC(assets, 'validator'), 'validator');
  plan.checkerTests = await parseSpecialTests(KIND_DESC(assets, 'checker'), 'checker');
}
