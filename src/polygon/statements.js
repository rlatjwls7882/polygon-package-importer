import { t } from '../i18n.js';
import { statementChanges } from './compare.js';

export async function syncStatements({api, id, plan, target, apply, unchanged}) {
  const wantedLanguages = new Set(plan.statements.map(s => s.lang));
  if (target) for (const lang of Object.keys(target.statements || {})) {
    if (!wantedLanguages.has(lang))
      await apply(t('syncDeletingStatement', lang), () => api.problem('deleteStatement', id, {lang}));
  }
  for (const statement of plan.statements) {
    const patch = statementChanges(target?.statements?.[statement.lang], statement);
    if (!patch) unchanged(t('syncStatement', statement.lang));
    else await apply(t('syncSavingStatement', statement.lang), () => api.problem('saveStatement', id, patch));
  }
}

export async function deleteStatementResources({api, id, target, apply}) {
  // Statement Resources (including images) are separate from problem.files.
  // A ZIP without importable statement attachments must not leave older
  // images on the problem. Delete them only after all other writes succeed.
  // On interruption the next run re-reads Polygon and removes only survivors.
  if (target) for (const file of target.statementResources) {
    await apply(t('syncDeletingOldStatementAttachment', file.name),
      () => api.problem('deleteStatementResource', id, {name:file.name}));
  }
}
