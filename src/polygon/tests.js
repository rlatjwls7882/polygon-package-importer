import { t } from '../i18n.js';
import { boolean, str, sameText, indexMap, manualTestChanges } from './compare.js';

export async function syncTests({api, id, plan, archive, target, read, apply, unchanged}) {
  const wantedTests = new Map(plan.tests.map(t => [t.index, t]));
  let oldTests = target?.tests || [];
  const oldGenerated = oldTests.some(t => !t.manual);
  const generated = plan.tests.filter(t => t.method === 'generated');
  const wantedScript = generated.map(t =>
    (t.group ? '<#-- @group ' + t.group + ' -->\n' : '') + t.cmd + ' > ' + t.index).join('\n');
  let currentScript = '';
  if (target && oldGenerated)
    currentScript = await read(t('syncComparingPreviousTestGeneratorScript'),
      () => api.problem('script', id, {testset:'tests'}, {raw:true}));
  let scriptDiffers = oldGenerated ? !sameText(currentScript, wantedScript) : generated.length > 0;
  if (oldGenerated && plan.tests.some(t =>
      t.method === 'manual' && oldTests.some(x => Number(x.index) === t.index && !x.manual)))
    scriptDiffers = true;

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
    const sampleOutput = test.sample && test.outputPath ? await archive.text(test.outputPath) : null;
    const props = manualTestChanges(test, remoteByIndex.get(test.index), input, sampleOutput);
    if (!props) unchanged(t('syncManualTest', test.index, plan.tests.length));
    else await apply(t('syncManualTest', test.index, plan.tests.length),
      () => api.problem('saveTest', id, props), true);
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
      if (Object.keys(props).length === 2) unchanged(t('syncGeneratedTestMetadata', test.index));
      else await apply(t('syncGeneratedTestMetadata', test.index),
        () => api.problem('saveTest', id, props), true);
    }
  }
}

export async function verifyTests({api, id, plan, read, unchanged}, testMutations) {
  if (testMutations > 0) {
    const tests = await read(t('syncVerifyingChangedTestNumbering'),
      () => api.problem('tests', id, {testset:'tests', noInputs:'true'}));
    if (!Array.isArray(tests) || tests.length !== plan.tests.length ||
        plan.tests.some(t => !tests.some(remote =>
          Number(remote.index) === t.index && !!remote.manual === (t.method === 'manual'))))
      throw Error(t('syncTestCountNumberingOrGenerationModeDiffers'));
  } else unchanged(t('syncAllTestsUnchanged'));
}
