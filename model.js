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
  if (!pattern) throw Error('테스트 경로 패턴이 없습니다.');
  if (!/^[-\w./%]+$/.test(pattern) || !/%(?:0[1-9]\d?)?d/.test(pattern))
    throw Error(`지원하지 않는 테스트 경로 패턴: ${pattern}`);
  const path = pattern.replace(/%(0([1-9]\d?))?d/, (_, a, width) => String(index).padStart(Number(width) || 0, '0'));
  if (path.includes('%')) throw Error(`지원하지 않는 테스트 경로 패턴: ${pattern}`);
  return path;
}

async function testPath(archive, pattern, index) {
  const path = asIndexPath(pattern, index);
  const candidates = [path, 'files/' + path, 'files/tests/' + path];
  const match = [...new Set(candidates)].find(p => archive.has(p));
  if (!match) throw Error(`테스트 데이터 누락: ${path}`);
  return match;
}

async function optionalText(archive, path) { return archive.has(path) ? archive.text(path) : ''; }
function resolveXmlText(xml) {
  // Do not allow external entities. DOMParser never loads external resources, but refuse DTD.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw Error('DOCTYPE/ENTITY가 포함된 problem.xml은 허용하지 않습니다.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'problem') throw Error('유효한 Polygon problem.xml이 아닙니다.');
  return doc.documentElement;
}

export async function loadPolygonPackage(archive) {
  const root = resolveXmlText(await archive.text('problem.xml'));
  const plan = { name: ATTR(root, 'short-name') || 'imported-problem', info: {},
    statements: [], sources: [], resources: [], aux: [], solutions: [], checker: '', validator: '', interactor: '',
    tests: [], groups: [], validatorTests: [], checkerTests: [], tags: [], warnings: [], unsupported: [] };

  const judging = CHILD(root, 'judging');
  if (!judging) throw Error('problem.xml에 judging 항목이 없습니다.');
  const testsets = CHILDREN(judging, 'testset');
  if (testsets.length !== 1 || ATTR(testsets[0], 'name') !== 'tests')
    throw Error('현재는 기본 testset인 tests 한 개만 지원합니다. (Polygon API에 testset 생성 기능이 없음)');
  const ts = testsets[0];
  const tl = Number(TEXT(ts, 'time-limit') || 1000);
  const ml0 = Number(TEXT(ts, 'memory-limit') || 256 * 1024 * 1024);
  const ml = ml0 > 1024 ? ml0 / (1024 * 1024) : ml0;
  if (!Number.isInteger(tl) || tl < 250 || tl > 15000 || tl % 50 || !Number.isInteger(ml) || ml < 4 || ml > 1024)
    throw Error(`API에 맞지 않는 시간/메모리 제한: ${tl}ms / ${ml}MB`);
  plan.info = { timeLimit: tl, memoryLimit: ml,
    inputFile: ATTR(judging, 'input-file') || 'stdin', outputFile: ATTR(judging, 'output-file') || 'stdout',
    interactive: !!CHILD(CHILD(root, 'assets'), 'interactor') };

  const allLanguages = new Set(CHILDREN(CHILD(root, 'statements'), 'statement').map(x => ATTR(x, 'language')));
  for (const p of archive.names()) {
    const m = p.match(/^statement-sections\/([^/]+)\/(?:name|legend)\.tex$/);
    if (m) allLanguages.add(m[1]);
  }
  if (!allLanguages.size) throw Error('패키지에 복원 가능한 문제 지문 언어가 없습니다.');
  for (const lang of allLanguages) {
    if (!/^[a-z][a-z0-9_-]{0,30}$/i.test(lang)) throw Error(`잘못된 언어명: ${lang}`);
    const prefix = `statement-sections/${lang}/`;
    const tex = { name: 'name.tex', legend: 'legend.tex', input: 'input.tex', output: 'output.tex',
      scoring: 'scoring.tex', interaction: 'interaction.tex', notes: 'notes.tex', tutorial: 'tutorial.tex' };
    const fields = { lang, encoding: 'UTF-8' };
    for (const [key, path] of Object.entries(tex)) fields[key] = await optionalText(archive, prefix + path);
    if (!fields.name && !fields.legend && !fields.input && !fields.output)
      throw Error(`${lang}의 statement-sections TeX 원본이 없습니다. 렌더링된 problem.tex만으로는 원본을 복원할 수 없습니다.`);
    if (!fields.name) fields.name = plan.name;
    if (fields.name.includes('\n') || fields.name.includes('\r')) throw Error(`${lang} 문제 제목에 줄바꿈이 있습니다.`);
    const xmlStatement = CHILDREN(CHILD(root, 'statements'), 'statement').find(x => ATTR(x, 'language') === lang);
    const charset = ATTR(xmlStatement, 'charset');
    if (charset && !/^utf-?8$/i.test(charset)) plan.warnings.push(`${lang}: 인코딩 ${charset}을 UTF-8로 해석합니다.`);
    plan.statements.push(fields);
  }

  function addSource(src) {
    if (!src) return '';
    const path = ATTR(src, 'path');
    const name = basename(path);
    if (!path || !archive.has(path)) throw Error(`소스 코드 누락: ${path || '(경로 없음)'}`);
    const sourceType = ATTR(src, 'type') || undefined;
    const existing = plan.sources.find(x => x.name === name);
    if (existing && existing.path !== path) throw Error(`동일 이름의 다른 소스 충돌: ${name}`);
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
    if (!plan[kind] && kind !== 'interactor') plan.warnings.push(`${kind}가 패키지에 설정되지 않았습니다.`);
  }
  const files = CHILD(root, 'files');
  // Polygon exports can repeat the same bundled header under several paths.
  // Polygon itself uses a flat resource namespace, so merge only identical files.
  for (const f of CHILDREN(CHILD(files, 'resources'), 'file')) {
    const path = ATTR(f, 'path');
    if (!path || !archive.has(path)) throw Error(`리소스 파일 누락: ${path}`);
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
      if (!valid) {
        plan.unsupported.push(`SOJ Checker 선택 메타데이터를 검증할 수 없습니다: ${path}. Checker 설정을 확인하세요.`);
      } else {
        plan.warnings.push(`SOJ 전용 Checker 선택 메타데이터 ${path}를 업로드에서 제외합니다. Polygon Checker는 ${plan.checker}로 복원합니다.`);
      }
      continue;
    }
    if (!validPolygonFileName(name)) {
      plan.unsupported.push(`Polygon API에 사용할 수 없는 리소스 파일명: ${name} (${path}). 파일명은 영문 또는 숫자로 시작해야 합니다.`);
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
      if (equal) {
        plan.warnings.push(`중복 리소스 ${name}: ${previous.path}, ${path}의 내용이 같아 한 번만 업로드합니다.`);
      } else {
        plan.unsupported.push(`리소스 ${name} 내용 충돌: ${previous.path}와 ${path}가 서로 다릅니다. Polygon의 같은 이름으로 안전하게 복원할 수 없습니다.`);
      }
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
    if (!path || !archive.has(path)) throw Error(`솔루션 원본 누락: ${path}`);
    const tag = TAGS[ATTR(el, 'tag').toLowerCase()];
    if (!tag) throw Error(`알 수 없는 솔루션 태그: ${ATTR(el, 'tag')}`);
    plan.solutions.push({ name: basename(path), path, tag, sourceType: ATTR(src, 'type') || undefined });
  }
  for (const file of [...plan.sources, ...plan.solutions, ...plan.aux]) {
    if (!validPolygonFileName(file.name))
      plan.unsupported.push(`Polygon API에 사용할 수 없는 소스/솔루션/보조 파일명: ${file.name} (${file.path})`);
  }
  plan.tags = CHILDREN(CHILD(root, 'tags'), 'tag').map(x => ATTR(x, 'value')).filter(Boolean);

  const xmlTests = CHILDREN(CHILD(ts, 'tests'), 'test');
  const declared = Number(TEXT(ts, 'test-count') || xmlTests.length);
  if (declared !== xmlTests.length || declared > 1000) throw Error('테스트 개수 선언이 다르거나 1000개를 초과합니다.');
  const pattern = TEXT(ts, 'input-path-pattern') || 'tests/%02d';
  for (let i = 0; i < xmlTests.length; i++) {
    const el = xmlTests[i];
    const method = ATTR(el, 'method');
    if (!['manual', 'generated'].includes(method)) throw Error(`지원하지 않는 테스트 방식: ${method} (${i+1}번)`);
    const test = { index: i + 1, method, description: ATTR(el, 'description'), sample: ATTR(el, 'sample') === 'true',
      group: ATTR(el, 'group'), points: el.hasAttribute('points') ? Number(ATTR(el,'points')) : null, cmd: ATTR(el, 'cmd') };
    const inputCandidate = asIndexPath(pattern, i + 1);
    const inputPath = [inputCandidate, 'files/' + inputCandidate, 'files/tests/' + inputCandidate].find(p => archive.has(p));
    if (method === 'manual') test.path = await testPath(archive, pattern, i + 1);
    else if (!test.cmd && inputPath) {
      // Full packages can contain generated inputs even without reusable commands.
      test.method = 'manual'; test.path = inputPath;
      plan.warnings.push(`테스트 ${i+1}은 제너레이터 명령이 없어 입력 데이터로 수동 복원합니다.`);
    } else if (!test.cmd || /[\r\n><]/.test(test.cmd) || ATTR(el, 'from-file')) {
      plan.unsupported.push(`테스트 ${i+1}: 명령을 안전하게 스크립트로 복원할 수 없습니다.`);
    }
    if (test.method === 'generated' && !/^[a-zA-Z_][\w./-]*(?:[ \t]+[^\r\n<>]+)*$/.test(test.cmd))
      plan.unsupported.push(`테스트 ${i+1}: 지원하지 않는 생성 명령 ${test.cmd}`);
    if (inputPath) test.path = inputPath;
    const answerPattern = TEXT(ts, 'answer-path-pattern');
    if (answerPattern) {
      const answer = asIndexPath(answerPattern, i + 1);
      test.outputPath = [answer, 'files/' + answer, 'files/tests/' + answer].find(p => archive.has(p));
    }
    if (test.points != null && (!Number.isFinite(test.points) || test.points < 0 || test.points >= 1e9))
      throw Error(`테스트 ${i+1}: 잘못된 점수`);
    plan.tests.push(test);
  }
  plan.groups = CHILDREN(CHILD(ts, 'groups'), 'group').map(el => ({
    name: ATTR(el, 'name'), feedbackPolicy: mapVerdict(ATTR(el, 'feedback-policy') || 'complete'),
    pointsPolicy: mapVerdict(ATTR(el, 'points-policy') || 'complete-group'),
    dependencies: CHILDREN(CHILD(el, 'dependencies'), 'dependency').map(d => ATTR(d, 'group')).filter(Boolean)
  }));
  if (plan.groups.some(g => !g.name)) throw Error('이름이 없는 테스트 그룹이 있습니다.');
  if (plan.tests.some(t => t.group && !plan.groups.some(g => g.name === t.group)))
    plan.unsupported.push('테스트가 참조하는 그룹이 그룹 정의 목록에 없습니다.');

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
      if (kind === 'validator' && !['VALID','INVALID'].includes(verdict)) throw Error('Validator Test 판정값 오류');
      if (kind === 'checker' && !['OK','WRONG_ANSWER','PRESENTATION_ERROR','CRASHED'].includes(verdict)) throw Error('Checker Test 판정값 오류');
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
  if (binaryPaths.size) plan.unsupported.push('바이너리 파일은 자동 업로드 불가: ' + [...binaryPaths].join(', '));
  if (sectionsExtras.length) plan.unsupported.push('지문 이미지/추가 리소스는 자동 업로드 불가: ' + sectionsExtras.slice(0,12).join(', '));
  for (const t of plan.tests) {
    for (const path of [t.path, t.outputPath].filter(Boolean)) {
      try { await archive.text(path); } catch { plan.unsupported.push(`테스트 ${t.index}: ${path}가 UTF-8 텍스트가 아닙니다.`); }
    }
  }
  for (const t of [...plan.validatorTests, ...plan.checkerTests]) {
    for (const path of [t.inputPath, t.outputPath, t.answerPath].filter(Boolean)) {
      try { await archive.text(path); } catch { plan.unsupported.push(`자체 테스트 ${t.index}: ${path}가 UTF-8 텍스트가 아닙니다.`); }
    }
  }
  if (plan.aux.length) plan.warnings.push('auxiliary-files 항목은 패키지별 차이가 있으므로 사후 확인이 필요합니다.');
  if (plan.tests.some(t => t.method === 'generated')) {
    plan.warnings.push('Generated 테스트는 problem.xml의 cmd로 스크립트를 재구성합니다. 원본 FreeMarker 스크립트는 복원되지 않습니다.');
    const sourceStems = new Set(plan.sources.map(f => f.name.replace(/\.[^.]+$/, '')));
    for (const t of plan.tests.filter(x => x.method === 'generated')) {
      const command = (t.cmd || '').trim().split(/\s+/)[0].replace(/\.exe$/i, '');
      if (command && !sourceStems.has(command.split('/').pop()))
        plan.unsupported.push(`테스트 ${t.index}: 제너레이터 원본 ${command}이(가) 패키지 실행 파일 목록에 없습니다.`);
    }
  }
  if (plan.groups.length) plan.warnings.push('테스트 그룹 설정을 적용합니다. 그룹별 점수 및 특수 옵션은 Polygon에서 추가 확인하세요.');
  if ([...plan.sources, ...plan.solutions].some(f => f.sourceType))
    plan.warnings.push('원본 ZIP의 컴파일러 type 식별자는 Polygon API의 sourceType과 다를 수 있어 업로드 시 생략합니다. Polygon이 확장자로 언어를 판별하며, C++20 등 컴파일러 버전은 업로드 후 확인하세요.');
  plan.warnings.push('패키지에 없는 원본 수정 기록, 스트레스 테스트, materials 등의 메타데이터는 복원하지 않습니다.');
  return plan;
}
function KIND_DESC(assets, name) { return name === 'validator' ? CHILD(CHILD(assets, 'validators'), 'validator') : CHILD(assets, name); }
