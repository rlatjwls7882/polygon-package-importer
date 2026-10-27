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

export function sameTagList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const canon = arr => arr.map(x => String(x?.name ?? x)).sort().join('\0');
  return canon(a) === canon(b);
}

export function boolean(value) {return value === true || value === 'true';}
export function str(value) {return value == null ? '' : String(value);}

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

export function indexMap(values) {
  return new Map((values || []).map(x => [Number(x.index), x]));
}
