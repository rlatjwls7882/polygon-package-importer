import { t } from '../i18n.js';

export async function validatePackage(archive, plan) {
  if (plan.solutions.filter(solution => solution.tag === 'MA').length > 1)
    throw Error(t('syncZipContainsMultipleMainSolutions'));
  if (new Set(plan.solutions.map(solution => solution.name)).size !== plan.solutions.length)
    throw Error(t('syncZipContainsSolutionsWithDuplicateNames'));
  if (plan.info.interactive && !plan.interactor)
    throw Error(t('packageMissingInteractorSource'));
  const binaryPaths = new Set();
  // Sources and solutions must be textual. Binary statement resources cannot be safely
  // round-tripped through the current text-only API adapter.
  for (const {path} of [...plan.sources, ...plan.solutions, ...plan.resources, ...plan.aux]) {
    try {
      if ((await archive.text(path)).includes('\0')) binaryPaths.add(path);
    } catch { binaryPaths.add(path); }
  }
  const sectionsExtras = archive.names().filter(p => /^statement-sections\/[^/]+\//.test(p) &&
    !/\/(?:name|legend|input|output|notes|scoring|interaction|tutorial|example\.\d+(?:\.a|\.mu)?)\.tex?$/.test(p) &&
    !/\/example\.\d+(?:\.a|\.mu)?$/.test(p));
  if (binaryPaths.size) plan.unsupported.push(t('modelCannotUploadBinaryFiles', [...binaryPaths].join(', ')));
  if (sectionsExtras.length) plan.unsupported.push(t('modelCannotUploadStatementImagesOrExtraResources', sectionsExtras.slice(0,12).join(', ')));
  for (const test of plan.tests) {
    for (const path of [test.path, test.outputPath, test.sampleInputPath, test.sampleOutputPath, test.interactionLogPath].filter(Boolean)) {
      try { await archive.text(path); } catch { plan.unsupported.push(t('modelTestIsNotUtf8Text', test.index, path)); }
    }
  }
  for (const test of [...plan.validatorTests, ...plan.checkerTests]) {
    for (const path of [test.inputPath, test.outputPath, test.answerPath].filter(Boolean)) {
      try { await archive.text(path); } catch { plan.unsupported.push(t('modelSelfTestIsNotUtf8Text', test.index, path)); }
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
