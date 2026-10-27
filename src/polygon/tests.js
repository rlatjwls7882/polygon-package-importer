import { t } from '../i18n.js';
import { boolean, str, sameText, indexMap, manualTestChanges, testMetadataChanges } from './compare.js';

export async function syncTests({api, id, plan, archive, target, read, apply, unchanged, beforeReplacingTests}) {
  const groupsEnabled = plan.groups.length > 0;
  const sample = async test => {
    if (!test.sample) return {};
    const input = test.sampleInputPath || test.path;
    const output = test.sampleOutputPath || test.outputPath;
    return {
      input:input ? await archive.text(input) : undefined,
      output:output ? await archive.text(output) : undefined,
      log:plan.info?.interactive ? (test.interactionLogPath ? await archive.text(test.interactionLogPath) : '') : undefined
    };
  };
  const pendingGroups = new Map();
  const saveTest = async (props, label) => {
    // The two identity fields plus a non-empty group are the only changes.
    // Keep input/score/sample edits combined in one saveTest request. Empty
    // group clearing stays on that established path too.
    if (Object.keys(props).length === 3 && props.testGroup) {
      if (!pendingGroups.has(props.testGroup)) pendingGroups.set(props.testGroup, []);
      pendingGroups.get(props.testGroup).push(props.testIndex);
      return;
    }
    await apply(label, () => api.problem('saveTest', id, props), true);
  };

  const wantedTests = new Map(plan.tests.map(t => [t.index, t]));
  let oldTests = target?.tests || [];
  const oldGenerated = oldTests.some(t => !t.manual);
  const generated = plan.tests.filter(t => t.method === 'generated');
  // Assign groups explicitly afterwards. A script's @group annotation can leak
  // from one generated test into the next ungrouped test.
  const wantedScript = generated.map(test => test.cmd + ' > ' + test.index).join('\n');
  let currentScript = '';
  if (target && oldGenerated)
    currentScript = await read(t('syncComparingPreviousTestGeneratorScript'),
      () => api.problem('script', id, {testset:'tests'}, {raw:true}));
  let scriptDiffers = oldGenerated ? !sameText(currentScript, wantedScript) : generated.length > 0;
  if (oldGenerated && plan.tests.some(t =>
      t.method === 'manual' && oldTests.some(x => Number(x.index) === t.index && !x.manual)))
    scriptDiffers = true;

  if ((oldGenerated && scriptDiffers) || oldTests.some(remote => {
    const desired = wantedTests.get(Number(remote.index));
    return !desired || boolean(remote.manual) !== (desired.method === 'manual') ||
      str(remote.group) !== str(desired.group);
  })) await beforeReplacingTests?.();

  if (oldGenerated && scriptDiffers) {
    await apply(t('syncReplacingPreviousGeneratorScript'), () => api.problem('clearScript', id, {testset:'tests'}), true);
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
    await apply(t('syncDeletingUnnecessaryTests', toDelete.length),
      () => api.problem('deleteTest', id, {testset:'tests', testIndices}), true);
  }
  if (toDelete.length) {
    const snapshot = await read(t('syncCheckingTestsAfterDeletion'),
      () => api.problem('tests', id, {testset:'tests', noInputs:'false'}));
    if (!Array.isArray(snapshot)) throw Error(t('syncInvalidResponseWhenReloadingTests'));
    remoteByIndex = indexMap(snapshot);
  }

  for (const test of plan.tests.filter(t => t.method === 'manual')) {
    const input = await archive.text(test.path);
    const props = manualTestChanges(test, remoteByIndex.get(test.index), input, await sample(test), groupsEnabled);
    if (!props) unchanged(t('syncManualTest', test.index, plan.tests.length));
    else await saveTest(props, t('syncManualTest', test.index, plan.tests.length));
  }

  if (generated.length) {
    if (scriptDiffers) await apply(t('syncUploadingGeneratedTestScript'),
      () => api.problem('saveScript', id, {testset:'tests', source:wantedScript}), true);
    else unchanged(t('syncGeneratedTestScript'));
  }

  if (generated.length) {
    const activeTests = scriptDiffers ?
      await read(t('syncCheckingGeneratedTestList'), () => api.problem('tests', id, {testset:'tests', noInputs:'true'})) :
      oldTests;
    const activeByIndex = indexMap(activeTests);
    for (const test of generated) {
      const remote = activeByIndex.get(test.index);
      if (!remote || boolean(remote.manual)) throw Error(t('syncInvalidResponseWhenReloadingTests'));
      const props = {testset:'tests', testIndex:test.index,
        ...testMetadataChanges(test, remote, await sample(test), groupsEnabled)};
      if (Object.keys(props).length === 2) unchanged(t('syncGeneratedTestMetadata', test.index));
      else await saveTest(props, t('syncGeneratedTestMetadata', test.index));
    }
  }

  // All tests exist now, including any recreated by saveScript. Combine manual
  // and generated indices for the same destination without duplicating writes.
  for (const [testGroup, indices] of pendingGroups) {
    const testIndices = indices.sort((a, b) => a - b).join(',');
    await apply(t('syncAssigningTestGroup', testGroup, indices.length),
      () => api.problem('setTestGroup', id, {testset:'tests', testGroup, testIndices}), true);
  }
}

export async function verifyTests({api, id, plan, read, unchanged}, testMutations) {
  if (testMutations > 0) {
    const tests = await read(t('syncVerifyingChangedTestNumbering'),
      () => api.problem('tests', id, {testset:'tests', noInputs:'true'}));
    const byIndex = Array.isArray(tests) ? indexMap(tests) : new Map();
    if (!Array.isArray(tests) || tests.length !== plan.tests.length || byIndex.size !== tests.length ||
        plan.tests.some(test => {
          const remote = byIndex.get(test.index);
          return !remote || boolean(remote.manual) !== (test.method === 'manual') ||
            boolean(remote.useInStatements) !== test.sample ||
            (plan.groups.length && str(remote.group) !== str(test.group)) ||
            (test.points != null && (remote.points == null || Number(remote.points) !== test.points));
        }))
      throw Error(t('syncTestMetadataMismatch'));
  } else unchanged(t('syncAllTestsUnchanged'));
}
