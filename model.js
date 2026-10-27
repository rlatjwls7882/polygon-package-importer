import { t } from './i18n.js';
const CHILD = (el, tag) => el ? [...el.children].find(x => x.localName === tag) : null;
const CHILDREN = (el, tag) => el ? [...el.children].filter(x => x.localName === tag) : [];
const TEXT = (el, tag) => (CHILD(el, tag)?.textContent || '').trim();
const ATTR = (el, name, fallback = '') => el?.getAttribute(name) ?? fallback;
const basename = p => p.split('/').pop();
const validPolygonFileName = name => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name);
const mapVerdict = s => s.replaceAll('-', '_').toUpperCase();
const textDecoder = new TextDecoder('utf-8', {fatal:true});

const TAGS = {
  main: 'MA', accepted: 'OK', rejected: 'RJ', 'wrong-answer': 'WA',
  'time-limit-exceeded': 'TL', 'time-limit-exceeded-or-accepted': 'TO',
  'time-limit-exceeded-or-memory-limit-exceeded': 'TM',
  'presentation-error': 'PE', 'memory-limit-exceeded': 'ML',
  'do-not-run': 'NR', 'runtime-error': 'RE'
};
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

async function optionalText(archive, path) { return archive.has(path) ? archive.text(path) : ''; }
function resolveXmlText(xml) {
  // Do not allow external entities. DOMParser never loads external resources, but refuse DTD.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw Error(t('modelProblemXmlMustNotContainDoctypeOr'));
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'problem') throw Error(t('modelInvalidPolygonProblemXml'));
  return doc.documentElement;
}

export async function loadPolygonPackage(archive) {
  const root = resolveXmlText(await archive.text('problem.xml'));
  const plan = { name: ATTR(root, 'short-name') || 'imported-problem', info: {},
    statements: [], sources: [], resources: [], aux: [], solutions: [], checker: '', validator: '', interactor: '',
    tests: [], groups: [], validatorTests: [], checkerTests: [], tags: [], unsupported: [] };

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
  plan.info = { timeLimit: tl, memoryLimit: ml,
    inputFile: ATTR(judging, 'input-file') || 'stdin', outputFile: ATTR(judging, 'output-file') || 'stdout',
    interactive: !!CHILD(CHILD(root, 'assets'), 'interactor') };

  const allLanguages = new Set(CHILDREN(CHILD(root, 'statements'), 'statement').map(x => ATTR(x, 'language')));
  for (const p of archive.names()) {
    const m = p.match(/^statement-sections\/([^/]+)\/(?:name|legend)\.tex$/);
    if (m) allLanguages.add(m[1]);
  }
  if (!allLanguages.size) throw Error(t('modelNoRestorableStatementLanguagesWereFound'));
  for (const lang of allLanguages) {
    if (!/^[a-z][a-z0-9_-]{0,30}$/i.test(lang)) throw Error(t('modelInvalidLanguageName', lang));
    const prefix = `statement-sections/${lang}/`;
    const tex = { name: 'name.tex', legend: 'legend.tex', input: 'input.tex', output: 'output.tex',
      scoring: 'scoring.tex', interaction: 'interaction.tex', notes: 'notes.tex', tutorial: 'tutorial.tex' };
    const fields = { lang, encoding: 'UTF-8' };
    for (const [key, path] of Object.entries(tex)) fields[key] = await optionalText(archive, prefix + path);
    if (!fields.name && !fields.legend && !fields.input && !fields.output)
      throw Error(t('modelMissingStatementSource', lang));
    if (!fields.name) fields.name = plan.name;
    if (fields.name.includes('\n') || fields.name.includes('\r')) throw Error(t('modelProblemTitleInContainsANewline', lang));
    plan.statements.push(fields);
  }

  function addSource(src) {
    if (!src) return '';
    const path = ATTR(src, 'path');
    const name = basename(path);
    if (!path || !archive.has(path)) throw Error(t('modelMissingSourceFile', path || t('modelNoPath')));
    const sourceType = ATTR(src, 'type') || undefined;
    const existing = plan.sources.find(x => x.name === name);
    if (existing && existing.path !== path) throw Error(t('modelDifferentSourceFilesShareTheSameName', name));
    if (!existing) plan.sources.push({ name, path, sourceType });
    return name;
  }
  const assets = CHILD(root, 'assets');
  for (const e of CHILDREN(CHILD(CHILD(root, 'files'), 'executables'), 'executable'))
    addSource(CHILD(e, 'source'));
  for (const [kind, xmlTag] of [['checker','checker'], ['validator','validator'], ['interactor','interactor']]) {
    const desc = KIND_DESC(assets, xmlTag);
    if (!desc) continue;
    const src = CHILD(desc, 'source');
    const standard = kind === 'checker' && ATTR(desc, 'name').startsWith('std::');
    plan[kind] = standard ? ATTR(desc, 'name') : src ? addSource(src) : '';
  }
  const files = CHILD(root, 'files');
  // Polygon exports can repeat the same bundled header under several paths.
  // Polygon itself uses a flat resource namespace, so merge only identical files.
  for (const f of CHILDREN(CHILD(files, 'resources'), 'file')) {
    const path = ATTR(f, 'path');
    if (!path || !archive.has(path)) throw Error(t('modelMissingResource', path));
    const name = basename(path);
    if (name === '.checker-selection-v1') {
      // SOJ packages attach this private marker when a built-in checker is
      // selected. It is not a Polygon resource and its name is rejected by
      // problem.saveFile. Do not skip arbitrary hidden resources.
      const parts = (await archive.text(path)).trimEnd().split('\t');
      const folder = path.match(/^files\/soj-checkers\/([0-9a-f]{64})\/\.checker-selection-v1$/);
      const valid = folder && parts.length === 5 &&
        parts[0] === 'SOJ-CHECKER-SELECTION' && parts[1] === '1' &&
        parts[2] === 'builtin' && /^[a-z0-9_-]+$/.test(parts[3]) &&
        parts[4] === folder[1] &&
        (plan.checker === `std::${parts[3]}.cpp` || plan.checker === `std::${parts[3]}`);
      if (!valid) plan.unsupported.push(t('modelCannotVerifySojCheckerSelectionMetadataCheck', path));
      continue;
    }
    if (!validPolygonFileName(name)) {
      plan.unsupported.push(t('modelInvalidResourceFilename', name, path));
      continue;
    }
    const previous = plan.resources.find(x => x.name === name);
    if (previous) {
      const [before, after] = await Promise.all([archive.bytes(previous.path), archive.bytes(path)]);
      let equal = before.length === after.length && before.every((byte, i) => byte === after[i]);
      if (!equal) {
        // A package may include identical text with Windows/Unix line endings.
        try {
          const normalize = bytes => textDecoder.decode(bytes).replace(/\r\n?/g, '\n');
          equal = normalize(before) === normalize(after);
        } catch { /* Binary resources must match byte-for-byte. */ }
      }
      if (!equal)
        plan.unsupported.push(t('modelResourceNameConflict', name, previous.path, path));
      continue;
    }
    plan.resources.push({ name, path });
  }
  for (const f of CHILDREN(CHILD(files, 'auxiliary-files'), 'file')) {
    const path = ATTR(f, 'path');
    if (path && archive.has(path)) plan.aux.push({ name: basename(path), path });
  }
  for (const el of CHILDREN(CHILD(assets, 'solutions'), 'solution')) {
    const src = CHILD(el, 'source'), path = ATTR(src, 'path');
    if (!path || !archive.has(path)) throw Error(t('modelMissingSolutionSource', path));
    const tag = TAGS[ATTR(el, 'tag').toLowerCase()];
    if (!tag) throw Error(t('modelUnknownSolutionTag', ATTR(el, 'tag')));
    plan.solutions.push({ name: basename(path), path, tag, sourceType: ATTR(src, 'type') || undefined });
  }
  for (const file of [...plan.sources, ...plan.solutions, ...plan.aux]) {
    if (!validPolygonFileName(file.name))
      plan.unsupported.push(t('modelInvalidSourceFilename', file.name, file.path));
  }
  plan.tags = CHILDREN(CHILD(root, 'tags'), 'tag').map(x => ATTR(x, 'value')).filter(Boolean);

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

  const binaryPaths = new Set();
  // Sources and solutions must be textual. Binary statement resources cannot be safely
  // round-tripped through the current text-only API adapter.
  for (const {path} of [...plan.sources, ...plan.solutions, ...plan.resources, ...plan.aux]) {
    const data = await archive.bytes(path);
    if (data.includes(0)) binaryPaths.add(path);
    else {
      try { textDecoder.decode(data); }
      catch { binaryPaths.add(path); }
    }
  }
  const sectionsExtras = archive.names().filter(p => /^statement-sections\/[^/]+\//.test(p) &&
    !/\/(?:name|legend|input|output|notes|scoring|interaction|tutorial|example\.\d+(?:\.a|\.mu)?)\.tex?$/.test(p) &&
    !/\/example\.\d+(?:\.a|\.mu)?$/.test(p));
  if (binaryPaths.size) plan.unsupported.push(t('modelCannotUploadBinaryFiles', [...binaryPaths].join(', ')));
  if (sectionsExtras.length) plan.unsupported.push(t('modelCannotUploadStatementImagesOrExtraResources', sectionsExtras.slice(0,12).join(', ')));
  for (const t of plan.tests) {
    for (const path of [t.path, t.outputPath].filter(Boolean)) {
      try { await archive.text(path); } catch { plan.unsupported.push(t('modelTestIsNotUtf8Text', t.index, path)); }
    }
  }
  for (const t of [...plan.validatorTests, ...plan.checkerTests]) {
    for (const path of [t.inputPath, t.outputPath, t.answerPath].filter(Boolean)) {
      try { await archive.text(path); } catch { plan.unsupported.push(t('modelSelfTestIsNotUtf8Text', t.index, path)); }
    }
  }
  if (plan.tests.some(t => t.method === 'generated')) {
    const sourceStems = new Set(plan.sources.map(f => f.name.replace(/\.[^.]+$/, '')));
    for (const t of plan.tests.filter(x => x.method === 'generated')) {
      const command = (t.cmd || '').trim().split(/\s+/)[0].replace(/\.exe$/i, '');
      if (command && !sourceStems.has(command.split('/').pop()))
        plan.unsupported.push(t('modelTestGeneratorSourceIsMissingFromThe', t.index, command));
    }
  }
  return plan;
}
function KIND_DESC(assets, name) { return name === 'validator' ? CHILD(CHILD(assets, 'validators'), 'validator') : CHILD(assets, name); }
