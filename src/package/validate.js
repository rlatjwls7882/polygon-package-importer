import { t } from '../i18n.js';

export async function validatePackage(archive, plan) {
  if (plan.solutions.filter(solution => solution.tag === 'MA').length > 1)
    throw Error(t('syncZipContainsMultipleMainSolutions'));
  if (!plan.solutions.some(solution => solution.tag === 'MA')) throw Error(t('formatMissingMain'));
  if (!plan.tests.length || !plan.checker) throw Error(t('formatIncompletePackage'));
  if (plan.checkerPercent && !plan.tests.some(test => test.points != null))
    throw Error(t('formatPercentageNeedsPoints'));
  const groupNames = new Set(plan.groups.map(group => group.name));
  for (const solution of plan.solutions) for (const extra of solution.extraTags || []) {
    if ((extra.testset && extra.testset !== 'tests') ||
        (extra.testGroup && !groupNames.has(extra.testGroup)))
      throw Error(t('formatInvalidExtraTag', solution.name));
  }
  if (new Set(plan.solutions.map(solution => solution.name)).size !== plan.solutions.length)
    throw Error(t('syncZipContainsSolutionsWithDuplicateNames'));
  if (plan.info.interactive && !plan.interactor)
    throw Error(t('packageMissingInteractorSource'));
  const checked = new Map();
  const inspect = async (path, checkNul = false) => {
    if (!checked.has(path) || (checkNul && checked.get(path).valid && checked.get(path).hasNul === undefined)) {
      try {
        const text = await archive.text(path);
        checked.set(path, {valid:true, ...(checkNul ? {hasNul:text.includes('\0')} : {})});
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        checked.set(path, {valid:false, hasNul:false});
      }
    }
    return checked.get(path);
  };
  const binaryPaths = new Set();
  // Sources and solutions must be textual. Binary statement resources cannot be safely
  // round-tripped through the current text-only API adapter.
  for (const {path} of [...plan.sources, ...plan.solutions, ...plan.resources, ...plan.aux]) {
    const result = await inspect(path, true);
    if (!result.valid || result.hasNul) binaryPaths.add(path);
  }
  const sectionsExtras = archive.names().filter(p => /^statement-sections\/[^/]+\//.test(p) &&
    !/\/(?:name|legend|input|output|notes|scoring|interaction|tutorial|example\.\d+(?:\.a|\.mu)?)\.tex?$/.test(p) &&
    !/\/example\.\d+(?:\.a|\.mu)?$/.test(p));
  if (binaryPaths.size) plan.unsupported.push(t('modelCannotUploadBinaryFiles', [...binaryPaths].join(', ')));
  if (sectionsExtras.length) plan.unsupported.push(t('modelCannotUploadStatementImagesOrExtraResources', sectionsExtras.slice(0,12).join(', ')));
  for (const test of plan.tests) {
    for (const path of [test.path, test.outputPath, test.sampleInputPath, test.sampleOutputPath, test.interactionLogPath].filter(Boolean)) {
      if (!(await inspect(path)).valid) plan.unsupported.push(t('modelTestIsNotUtf8Text', test.index, path));
    }
  }
  for (const test of [...plan.validatorTests, ...plan.checkerTests]) {
    for (const path of [test.inputPath, test.outputPath, test.answerPath].filter(Boolean)) {
      if (!(await inspect(path)).valid) plan.unsupported.push(t('modelSelfTestIsNotUtf8Text', test.index, path));
    }
  }
  if (plan.tests.some(test => test.method === 'generated')) {
    const sourceStems = new Set(plan.sources.map(f => f.name.replace(/\.[^.]+$/, '')));
    for (const test of plan.tests.filter(x => x.method === 'generated')) {
      const command = (test.cmd || '').trim().split(/\s+/)[0].replace(/\.exe$/i, '');
      if (command && !sourceStems.has(command.split('/').pop()))
        plan.unsupported.push(t('modelTestGeneratorSourceIsMissingFromThe', test.index, command));
    }
  }
}
