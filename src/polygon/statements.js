import { t } from '../i18n.js';
import { statementChanges } from './compare.js';

export async function syncStatements({api, id, plan, target, apply, unchanged}) {
  const wantedLanguages = new Set(plan.statements.map(s => s.lang));
  if (target) for (const lang of Object.keys(target.statements || {})) {
    if (!wantedLanguages.has(lang))
      await apply(t('syncDeletingStatement', lang), () => api.problem('deleteStatement', id, {lang}));
  }
  const patches = plan.statements.map(statement => ({statement,
    patch:statementChanges(target?.statements?.[statement.lang], statement)}));
  // Native non-interactive ZIPs can retain a dormant interaction.tex. Polygon
  // hides it in statements() and rejects its setter unless interaction is on.
  const temporaryInteraction = !plan.info.interactive && patches.some(({patch}) => patch?.interaction);
  try {
    if (temporaryInteraction)
      await apply(t('syncStatementInteractionOn'), () => api.problem('updateInfo', id, {interactive:'true'}));
    for (const {statement, patch} of patches) {
      if (!patch) unchanged(t('syncStatement', statement.lang));
      else await apply(t('syncSavingStatement', statement.lang), () => api.problem('saveStatement', id, patch));
    }
  } finally {
    if (temporaryInteraction)
      await apply(t('syncStatementInteractionOff'), () => api.problem('updateInfo', id, {interactive:'false'}));
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
