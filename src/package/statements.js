import { t } from '../i18n.js';
import { CHILD, CHILDREN, ATTR } from './xml.js';
const optionalText = (archive, path) => archive.has(path) ? archive.text(path) : '';

export async function readStatements(root, archive, plan) {
  const allLanguages = new Set(CHILDREN(CHILD(root, 'statements'), 'statement').map(x => ATTR(x, 'language')));
  for (const p of archive.names()) {
    const m = p.match(/^statement-sections\/([^/]+)\/(?:name|legend)\.tex$/);
    if (m) allLanguages.add(m[1]);
  }
  if (!allLanguages.size) throw Error(t('modelNoRestorableStatementLanguagesWereFound'));
  for (const lang of allLanguages) {
    if (!/^[a-z][a-z0-9_-]{0,30}$/i.test(lang)) throw Error(t('modelInvalidLanguageName', lang));
    const prefix = `statement-sections/${lang}/`;
    const tex = { name: 'name.tex', legend: 'legend.tex', input: 'input.tex', output: 'output.tex',
      scoring: 'scoring.tex', interaction: 'interaction.tex', notes: 'notes.tex', tutorial: 'tutorial.tex' };
    const fields = { lang, encoding: 'UTF-8' };
    for (const [key, path] of Object.entries(tex)) fields[key] = await optionalText(archive, prefix + path);
    if (!fields.name && !fields.legend && !fields.input && !fields.output)
      throw Error(t('modelMissingStatementSource', lang));
    if (!fields.name) fields.name = plan.name;
    if (fields.name.includes('\n') || fields.name.includes('\r')) throw Error(t('modelProblemTitleInContainsANewline', lang));
    plan.statements.push(fields);
  }
}
