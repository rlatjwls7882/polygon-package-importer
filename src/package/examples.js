import { t } from '../i18n.js';

export async function readExamples(archive, plan) {
  const samples = plan.tests.filter(test => test.sample);
  for (let i = 0; i < samples.length; i++) {
    const test = samples[i];
    for (const [field, suffix] of [['sampleInputPath',''], ['sampleOutputPath','.a'], ['interactionLogPath','.mu']]) {
      const paths = plan.statements.flatMap(statement => {
        const name = `statement-sections/${statement.lang}/example.${i + 1}${suffix}`;
        return [name, name + '.tex'].filter(path => archive.has(path));
      });
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
