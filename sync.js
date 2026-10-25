// Differential synchronization of a Polygon package with an existing working copy.
// Read existing manual test inputs in ONE problem.tests call, then submit only
// differences. There is no persistent local checkpoint: remote state is truth.

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
const normal = text => String(text).replace(/\r\n?/g, '\n');
export const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  normal(a) === normal(b);

function rawTestInput(remote) {
  if (!remote || !remote.manual) return null;
  if (typeof remote.inputBase64 === 'string') {
    try {
      const raw = atob(remote.inputBase64);
      const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
      return decoder.decode(bytes);
    } catch { return null; }
  }
  // Polygon also supplies a lossy UTF-8 string. Only use it for plain text
  // where neither side can contain the replacement character.
  if (typeof remote.input === 'string' && !remote.input.includes('\uFFFD'))
    return remote.input;
  return null;
}

export function inputMatches(remote, desired) {
  if (typeof desired !== 'string' || desired.includes('\uFFFD')) return false;
  return sameText(rawTestInput(remote), desired);
}

function sameTagList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const canon = arr => arr.map(x => String(x?.name ?? x)).sort().join('\0');
  return canon(a) === canon(b);
}

function boolean(value) {return value === true || value === 'true';}
function str(value) {return value == null ? '' : String(value);}

export function infoChanges(current, desired) {
  const patch = {};
  for (const key of ['timeLimit', 'memoryLimit', 'inputFile', 'outputFile', 'interactive']) {
    const actual = current?.[key];
    const expected = desired[key];
    if (key === 'timeLimit' || key === 'memoryLimit') {
      if (Number(actual) !== Number(expected)) patch[key] = expected;
    } else if (key === 'interactive') {
      if (boolean(actual) !== boolean(expected)) patch[key] = String(boolean(expected));
    } else if (str(actual || (key === 'inputFile' ? 'stdin' : 'stdout')) !== str(expected))
      patch[key] = expected;
  }
  return patch;
}

export function statementChanges(remote, statement) {
  const changed = { lang:statement.lang };
  if (!remote) return {...statement};
  for (const key of ['name', 'legend', 'input', 'output', 'scoring', 'interaction', 'notes', 'tutorial']) {
    if (!sameText(str(remote[key]), str(statement[key]))) changed[key] = statement[key] ?? '';
  }
  return Object.keys(changed).length === 1 ? null : changed;
}

export function manualTestChanges(test, remote, input, sampleOutput) {
  const props = {testset:'tests', testIndex:test.index};
  const newTest = !remote || !remote.manual;
  const differentInput = newTest || !inputMatches(remote, input);
  if (differentInput) props.testInput = input;
  if (newTest || str(remote.description) !== str(test.description))
    props.testDescription = test.description || '';
  if (newTest || boolean(remote.useInStatements) !== !!test.sample)
    props.testUseInStatements = String(!!test.sample);
  if (test.group && (newTest || str(remote.group) !== test.group)) props.testGroup = test.group;
  if (test.points !== null &&
      (newTest || remote.points == null || Number(remote.points) !== Number(test.points)))
    props.testPoints = test.points;
  if (test.sample) {
    // A sample's preview is distinct from the judge input in the API.
    if (newTest || !sameText(str(remote.inputForStatement), input))
      props.testInputForStatements = input;
    if (sampleOutput != null && (newTest || !sameText(str(remote.outputForStatement), sampleOutput)))
      props.testOutputForStatements = sampleOutput;
  }
  return Object.keys(props).length === 2 ? null : props;
}

function indexMap(values) {
  return new Map((values || []).map(x => [Number(x.index), x]));
}

export async function syncPackage({api, id, plan, archive, target = null, read, write, skip}) {
  // Polygon permits only one MA solution. Reject ambiguous packages before
  // any writes, rather than leaving a partially updated working copy.
  if (plan.solutions.filter(s => s.tag === 'MA').length > 1)
    throw Error('ZIP에 메인 솔루션이 여러 개 있습니다.');
  if (new Set(plan.solutions.map(s => s.name)).size !== plan.solutions.length)
    throw Error('ZIP에 이름이 중복된 솔루션이 있습니다.');
  if (target && !Array.isArray(target.statementResources))
    throw Error('기존 지문 첨부 리소스 목록을 조회하지 못해 덮어쓰기를 중단했습니다.');

  let mutations = 0, testMutations = 0, skipped = 0;
  const apply = async (label, fn, isTest = false) => {
    // Mark mutation before sending; timeouts/unknown server errors may have committed.
    mutations++;
    if (isTest) testMutations++;
    return write(label, fn);
  };
  const unchanged = label => {skipped++; skip?.(label);};
  const existing = !!target;
  const fileTypes = [
    ['source', plan.sources, 'sourceFiles'],
    ['resource', plan.resources, 'resourceFiles'],
    ['aux', plan.aux, 'auxFiles']
  ];

  const [currentInfo, currentChecker, currentValidator, currentInteractor, currentTags] =
    existing ? await Promise.all([
      read('시간·메모리 설정 비교', () => api.problem('info', id)),
      plan.checker ? read('Checker 비교', () => api.problem('checker', id)) : Promise.resolve(null),
      plan.validator ? read('Validator 비교', () => api.problem('validator', id)) : Promise.resolve(null),
      plan.interactor ? read('Interactor 비교', () => api.problem('interactor', id)) : Promise.resolve(null),
      read('태그 비교', () => api.problem('viewTags', id))
    ]) : [null, null, null, null, []];

  const changes = infoChanges(currentInfo, plan.info);
  if (Object.keys(changes).length || !existing)
    await apply('시간·메모리·입출력 설정', () => api.problem('updateInfo', id, changes));
  else unchanged('시간·메모리·입출력 설정');

  const wantedLanguages = new Set(plan.statements.map(s => s.lang));
  if (existing) for (const lang of Object.keys(target.statements || {})) {
    if (!wantedLanguages.has(lang))
      await apply('기존 지문 삭제: ' + lang, () => api.problem('deleteStatement', id, {lang}));
  }
  for (const statement of plan.statements) {
    const patch = statementChanges(target?.statements?.[statement.lang], statement);
    if (!patch) unchanged('지문: ' + statement.lang);
    else await apply('지문 저장: ' + statement.lang, () => api.problem('saveStatement', id, patch));
  }

  // Upload source and resource files before changing checker/generator settings.
  for (const [type, list, key] of fileTypes) {
    const remote = new Map((target?.files?.[key] || []).map(f => [f.name, f]));
    for (const file of list) {
      const localContent = await archive.text(file.path);
      const old = remote.get(file.name);
      let same = false;
      if (old) {
        // A different length proves difference without a download.
        const length = Number(old.length);
        if (!Number.isFinite(length) || length === encoder.encode(localContent).length) {
          const remoteContent = await read(type + ' 비교: ' + file.name,
            () => api.problem('viewFile', id, {type, name:file.name}, {raw:true}));
          same = sameText(remoteContent, localContent);
        }
      }
      if (same) unchanged(type + ': ' + file.name);
      else await apply(type + ' 저장: ' + file.name,
        () => api.problem('saveFile', id, {type, name:file.name, file:localContent}));
    }
  }

  const remoteSolutions = new Map((target?.solutions || []).map(s => [s.name, s]));
  const wantedMain = plan.solutions.find(s => s.tag === 'MA');
  const previousMain = (target?.solutions || []).find(s => s.tag === 'MA');
  if (wantedMain && previousMain && previousMain.name !== wantedMain.name) {
    // saveSolution(tag=MA) is rejected while another solution has that tag.
    // Demote the old main without deleting its content; obsolete solutions
    // are removed only after the new main has been uploaded successfully.
    const retained = plan.solutions.find(s => s.name === previousMain.name);
    const tag = retained?.tag ?? 'OK';
    await apply('기존 메인 솔루션 태그 변경: ' + previousMain.name,
      () => api.problem('saveSolution', id, {name:previousMain.name, tag}));
    remoteSolutions.set(previousMain.name, {...previousMain, tag});
  }
  for (const solution of plan.solutions) {
    const old = remoteSolutions.get(solution.name);
    const localContent = await archive.text(solution.path);
    let same = false;
    if (old) {
      const length = Number(old.length);
      if (!Number.isFinite(length) || length === encoder.encode(localContent).length) {
        const content = await read('솔루션 비교: ' + solution.name,
          () => api.problem('viewSolution', id, {name:solution.name}, {raw:true}));
        same = sameText(content, localContent);
      }
    }
    const tagDiff = !old || old.tag !== solution.tag;
    if (same && !tagDiff) unchanged('솔루션: ' + solution.name);
    else await apply('솔루션 저장: ' + solution.name, () => api.problem('saveSolution', id, {
      name:solution.name, ...(!same ? {file:localContent} : {}), ...(tagDiff ? {tag:solution.tag} : {})
    }));
  }

  for (const [kind, method, actual] of [
    ['Checker', 'setChecker', currentChecker],
    ['Validator', 'setValidator', currentValidator],
    ['Interactor', 'setInteractor', currentInteractor]
  ]) {
    const prop = kind.toLowerCase();
    if (!plan[prop]) continue;
    if (existing && actual === plan[prop]) unchanged(kind);
    else await apply(kind + ' 선택', () => api.problem(method, id, {[prop]:plan[prop]}));
  }

  // Drop only truly obsolete files after replacing references.
  if (existing) {
    for (const [type, list, key] of fileTypes) {
      const wanted = new Set(list.map(x => x.name));
      const protectedFiles = new Set(type === 'resource' ?
        ['olymp.sty', 'problem.tex', 'statements.ftl'] : []);
      for (const file of target.files?.[key] || []) {
        if (!wanted.has(file.name) && !protectedFiles.has(file.name))
          await apply('기존 ' + type + ' 파일 삭제: ' + file.name,
            () => api.problem('deleteFile', id, {type, name:file.name}));
      }
    }
    for (const old of target.solutions || []) if (!plan.solutions.some(s => s.name === old.name))
      await apply('기존 솔루션 삭제: ' + old.name,
        () => api.problem('deleteSolution', id, {name:old.name}));
  }

  const desiredGroups = plan.groups.length > 0 || plan.tests.some(t => t.group);
  const currentGroups = (target?.tests || []).some(t => t.group);
  if (desiredGroups && (!existing || !currentGroups))
    await apply('테스트 그룹 활성화', () => api.problem('enableGroups', id, {testset:'tests', enable:'true'}));
  else if (!desiredGroups && currentGroups)
    await apply('사용하지 않는 테스트 그룹 비활성화',
      () => api.problem('enableGroups', id, {testset:'tests', enable:'false'}));

  const wantedPoints = plan.tests.some(t => t.points !== null);
  const existingPoints = (target?.tests || []).some(t => t.points != null);
  if (wantedPoints !== existingPoints || (wantedPoints && !existing))
    await apply('테스트 점수 설정', () => api.problem('enablePoints', id, {enable:String(wantedPoints)}));

  const wantedTests = new Map(plan.tests.map(t => [t.index, t]));
  let oldTests = target?.tests || [];
  const oldGenerated = oldTests.some(t => !t.manual);
  const generated = plan.tests.filter(t => t.method === 'generated');
  const wantedScript = generated.map(t =>
    (t.group ? '<#-- @group ' + t.group + ' -->\n' : '') + t.cmd + ' > ' + t.index).join('\n');
  let currentScript = '';
  if (existing && oldGenerated)
    currentScript = await read('기존 테스트 생성 스크립트 비교',
      () => api.problem('script', id, {testset:'tests'}, {raw:true}));
  let scriptDiffers = oldGenerated ? !sameText(currentScript, wantedScript) : generated.length > 0;
  if (oldGenerated && plan.tests.some(t =>
      t.method === 'manual' && oldTests.some(x => Number(x.index) === t.index && !x.manual)))
    scriptDiffers = true;

  if (oldGenerated && scriptDiffers) {
    await apply('기존 생성 스크립트 교체', () => api.problem('clearScript', id, {testset:'tests'}), true);
    oldTests = oldTests.filter(t => t.manual);
  }

  let remoteByIndex = indexMap(oldTests);
  const toDelete = oldTests.filter(t =>
    !wantedTests.has(Number(t.index)) ||
    (t.manual && wantedTests.get(Number(t.index))?.method !== 'manual'));
  if (toDelete.length) {
    // Polygon supports deleting multiple tests in one atomic pre-check,
    // avoiding one API round trip per obsolete manual test.
    const testIndices = toDelete.map(t => Number(t.index)).sort((a, b) => b - a).join(',');
    await apply('불필요한 기존 테스트 일괄 삭제: ' + toDelete.length + '개',
      () => api.problem('deleteTest', id, {testset:'tests', testIndices}), true);
  }
  if (toDelete.length) {
    const snapshot = await read('테스트 삭제 후 현재 상태 확인',
      () => api.problem('tests', id, {testset:'tests', noInputs:'false'}));
    if (!Array.isArray(snapshot)) throw Error('테스트 재조회 결과가 올바르지 않습니다.');
    remoteByIndex = indexMap(snapshot);
  }

  for (const test of plan.tests.filter(t => t.method === 'manual')) {
    const input = await archive.text(test.path);
    const sampleOutput = test.sample && test.outputPath ? await archive.text(test.outputPath) : null;
    const props = manualTestChanges(test, remoteByIndex.get(test.index), input, sampleOutput);
    if (!props) unchanged('수동 테스트 ' + test.index + '/' + plan.tests.length);
    else await apply('수동 테스트 ' + test.index + '/' + plan.tests.length,
      () => api.problem('saveTest', id, props), true);
  }

  if (generated.length) {
    if (scriptDiffers) await apply('생성 테스트 스크립트 업로드',
      () => api.problem('saveScript', id, {testset:'tests', source:wantedScript}), true);
    else unchanged('생성 테스트 스크립트');
  }

  if (generated.length) {
    const activeTests = scriptDiffers ?
      await read('생성 테스트 목록 검증', () => api.problem('tests', id, {testset:'tests', noInputs:'true'})) :
      oldTests;
    const activeByIndex = indexMap(activeTests);
    for (const test of generated) {
      const remote = activeByIndex.get(test.index);
      const props = {testset:'tests', testIndex:test.index};
      if (!remote || boolean(remote.useInStatements) !== !!test.sample)
        props.testUseInStatements = String(test.sample);
      if (!remote || str(remote.description) !== str(test.description))
        props.testDescription = test.description || '';
      if (test.group && (!remote || remote.group !== test.group)) props.testGroup = test.group;
      if (test.points !== null && (!remote || Number(remote.points) !== Number(test.points)))
        props.testPoints = test.points;
      if (test.sample && test.path) {
        const input = await archive.text(test.path);
        if (!sameText(str(remote?.inputForStatement), input)) props.testInputForStatements = input;
      }
      if (test.sample && test.outputPath) {
        const output = await archive.text(test.outputPath);
        if (!sameText(str(remote?.outputForStatement), output)) props.testOutputForStatements = output;
      }
      if (Object.keys(props).length === 2) unchanged('생성 테스트 메타데이터 ' + test.index);
      else await apply('생성 테스트 메타데이터 ' + test.index,
        () => api.problem('saveTest', id, props), true);
    }
  }

  if (plan.groups.length) {
    const current = existing ? await read('테스트 그룹 정책 비교',
      () => api.problem('viewTestGroup', id, {testset:'tests'})) : [];
    for (const group of plan.groups) {
      const previous = (Array.isArray(current) ? current : []).find(x => x.name === group.name);
      const depends = group.dependencies.join(',');
      const priorDepends = Array.isArray(previous?.dependencies) ?
        previous.dependencies.join(',') : str(previous?.dependencies);
      if (previous && previous.pointsPolicy === group.pointsPolicy &&
          previous.feedbackPolicy === group.feedbackPolicy && priorDepends === depends)
        unchanged('테스트 그룹: ' + group.name);
      else await apply('테스트 그룹 설정: ' + group.name,
        () => api.problem('saveTestGroup', id, {testset:'tests', group:group.name,
          pointsPolicy:group.pointsPolicy, feedbackPolicy:group.feedbackPolicy, dependencies:depends}));
    }
  }

  for (const [kind, tests, previous, method] of [
    ['Validator', plan.validatorTests, target?.validatorTests || [], 'saveValidatorTest'],
    ['Checker', plan.checkerTests, target?.checkerTests || [], 'saveCheckerTest']
  ]) {
    for (const test of tests) {
      const old = previous.find(x => Number(x.index) === test.index);
      const props = {testIndex:test.index, testVerdict:test.verdict,
        testInput:await archive.text(test.inputPath)};
      if (kind === 'Checker') {
        props.testOutput = await archive.text(test.outputPath);
        props.testAnswer = await archive.text(test.answerPath);
      }
      const equal = old && str(old.expectedVerdict || old.verdict || old.testVerdict) === test.verdict &&
        sameText(str(old.input || old.testInput), props.testInput) &&
        (kind !== 'Checker' ||
          (sameText(str(old.output || old.testOutput), props.testOutput) &&
           sameText(str(old.answer || old.testAnswer), props.testAnswer)));
      if (equal) unchanged(kind + ' 자체 테스트: ' + test.index);
      else await apply(kind + ' 자체 테스트: ' + test.index,
        () => api.problem(method, id, props));
    }
  }

  if (!existing || !sameTagList(currentTags, plan.tags))
    await apply('태그 설정', () => api.problem('saveTags', id, {tags:plan.tags.join(',')}));
  else unchanged('태그');

  if (testMutations > 0) {
    const tests = await read('변경된 테스트 번호 검증',
      () => api.problem('tests', id, {testset:'tests', noInputs:'true'}));
    if (!Array.isArray(tests) || tests.length !== plan.tests.length ||
        plan.tests.some(t => !tests.some(remote =>
          Number(remote.index) === t.index && !!remote.manual === (t.method === 'manual'))))
      throw Error('업로드 후 테스트 개수·번호·생성 방식이 ZIP과 다릅니다.');
  } else unchanged('동일한 테스트 전체');

  // Statement Resources (including images) are separate from problem.files.
  // A ZIP without importable statement attachments must not leave older
  // images on the problem. Delete them only after all other writes succeed.
  // On interruption the next run re-reads Polygon and removes only survivors.
  if (existing) for (const file of target.statementResources) {
    await apply('기존 지문 첨부 파일 삭제: ' + file.name,
      () => api.problem('deleteStatementResource', id, {name:file.name}));
  }

  return {mutations, testMutations, skipped};
}
