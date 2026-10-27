import { testsSnapshot } from './snapshot.js';
import { sampleContents } from './samples.js';
import { t } from '../i18n.js';
import { boolean, str, sameText, indexMap, manualTestChanges, testMetadataChanges } from './compare.js';

export async function syncTests({api, id, plan, archive, target, read, apply, unchanged, beforeReplacingTests}) {
  const groupsEnabled = plan.groups.length > 0;
  const sample = test => sampleContents(archive, plan, test);
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
  const originalByIndex = indexMap(oldTests);
  const oldGenerated = oldTests.some(t => !boolean(t.manual));
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
      t.method === 'manual' && originalByIndex.has(t.index) && !boolean(originalByIndex.get(t.index).manual)))
    scriptDiffers = true;

  if ((oldGenerated && scriptDiffers) || oldTests.some(remote => {
    const desired = wantedTests.get(Number(remote.index));
    return !desired || boolean(remote.manual) !== (desired.method === 'manual') ||
      str(remote.group) !== str(desired.group);
  })) await beforeReplacingTests?.();

  if (oldGenerated && scriptDiffers) {
    await apply(t('syncReplacingPreviousGeneratorScript'), () => api.problem('clearScript', id, {testset:'tests'}), true);
    oldTests = oldTests.filter(t => boolean(t.manual));
  }

  let remoteByIndex = indexMap(oldTests);
  const toDelete = oldTests.filter(t =>
    !wantedTests.has(Number(t.index)) ||
    (boolean(t.manual) && wantedTests.get(Number(t.index))?.method !== 'manual'));
  if (toDelete.length) {
    // Polygon supports deleting multiple tests in one atomic pre-check,
    // avoiding one API round trip per obsolete manual test.
    const testIndices = toDelete.map(t => Number(t.index)).sort((a, b) => b - a).join(',');
    await apply(t('syncDeletingUnnecessaryTests', toDelete.length),
      () => api.problem('deleteTest', id, {testset:'tests', testIndices}), true);
  }
  if (toDelete.length) {
    const snapshot = await read(t('syncCheckingTestsAfterDeletion'),
      () => api.problem('tests', id, {testset:'tests', noInputs:String(!plan.tests.some(test => test.method === 'manual'))}));
    remoteByIndex = indexMap(testsSnapshot(snapshot));
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
    const activeByIndex = indexMap(testsSnapshot(activeTests));
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

export async function verifyTests({api, id, plan, archive, read, unchanged}, testMutations) {
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
    for (const test of plan.tests) {
      const remote = byIndex.get(test.index);
      const remaining = testMetadataChanges(test, remote, await sampleContents(archive, plan, test), plan.groups.length > 0);
      if (Object.keys(remaining).length) throw Error(t('formatSampleMismatch', test.index));
    }
  } else unchanged(t('syncAllTestsUnchanged'));
}
