import { t } from '../i18n.js';

export async function readExamples(archive, plan) {
  const samples = plan.tests.filter(test => test.sample);
  const languages = new Set(plan.statements.map(statement => statement.lang));
  const found = new Map();
  for (const path of archive.names().sort()) {
    const match = path.match(/^statement-sections\/([^/]+)\/example\.(\d+)(\.a|\.mu)?(?:\.tex)?$/);
    if (!match || !languages.has(match[1])) continue;
    const index = Number(match[2]);
    if (!Number.isSafeInteger(index) || index < 1 || index > samples.length)
      throw Error(t('formatOrphanSample', path));
    const key = index + ':' + (match[3] || '');
    if (!found.has(key)) found.set(key, []);
    found.get(key).push(path);
  }
  for (let i = 0; i < samples.length; i++) {
    const test = samples[i];
    for (const [field, suffix] of [['sampleInputPath',''], ['sampleOutputPath','.a'], ['interactionLogPath','.mu']]) {
      const paths = found.get((i + 1) + ':' + suffix) || [];
      if (!paths.length) continue;
      const values = await Promise.all(paths.map(path => archive.text(path)));
      if (values.some(value => value.replace(/\r\n?/g, '\n') !== values[0].replace(/\r\n?/g, '\n')))
        throw Error(t('packageConflictingSamples', i + 1));
      test[field] = paths[0];
    }
    if (test.interactionLogPath && !plan.info.interactive)
      throw Error(t('packageUnexpectedInteractionLog', test.index));
  }
  if (plan.info.interactive)
    plan.info.useInteractionLogInExampleTests = samples.some(test => test.interactionLogPath);
}
