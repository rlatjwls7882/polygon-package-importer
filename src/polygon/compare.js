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
  const flags = ['interactive', 'runTwice', 'interactiveSecondRun', 'useInteractionLogInExampleTests'];
  for (const key of ['timeLimit', 'memoryLimit', 'inputFile', 'outputFile', ...flags]) {
    if (!Object.hasOwn(desired, key)) continue;
    if (['interactiveSecondRun', 'useInteractionLogInExampleTests'].includes(key) && !desired.interactive) continue;
    const actual = current?.[key], expected = desired[key];
    if (key === 'timeLimit' || key === 'memoryLimit') {
      if (Number(actual) !== Number(expected)) patch[key] = expected;
    } else if (flags.includes(key)) {
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

export function testMetadataChanges(test, remote, sample = {}, groupsEnabled = true) {
  const props = {};
  if (!remote || str(remote.description) !== str(test.description))
    props.testDescription = test.description || '';
  if (!remote || boolean(remote.useInStatements) !== !!test.sample)
    props.testUseInStatements = String(!!test.sample);
  if (groupsEnabled && str(remote?.group) !== str(test.group)) props.testGroup = test.group || '';
  if (test.points != null && (remote?.points == null || Number(remote.points) !== test.points))
    props.testPoints = test.points;
  {
    for (const [key, parameter, value] of [
      ['inputForStatement', 'testInputForStatements', sample.input],
      ['outputForStatement', 'testOutputForStatements', sample.output],
      ['interactionLogForStatement', 'testInteractionLogForStatements', sample.log]
    ]) if (value != null && !sameText(str(remote?.[key]), value)) props[parameter] = value;
  }
  return props;
}

export function manualTestChanges(test, remote, input, sample, groupsEnabled) {
  const props = {testset:'tests', testIndex:test.index,
    ...testMetadataChanges(test, remote, sample, groupsEnabled)};
  if (!remote || !boolean(remote.manual) || !inputMatches(remote, input)) props.testInput = input;
  return Object.keys(props).length === 2 ? null : props;
}

export function indexMap(values) {
  return new Map((values || []).map(x => [Number(x.index), x]));
}
