import { t } from '../i18n.js';
import { sameText } from './compare.js';
const encoder = new TextEncoder();

function packageFiles(plan) {
  return [
    ['source', plan.sources, 'sourceFiles'],
    ['resource', plan.resources, 'resourceFiles'],
    ['aux', plan.aux, 'auxFiles']
  ];
}

export async function syncFiles({api, id, plan, archive, target, read, apply, unchanged}) {
  const fileTypes = packageFiles(plan);
  // Upload source and resource files before changing checker/generator settings.
  for (const [type, list, key] of fileTypes) {
    const remote = new Map((target?.files?.[key] || []).map(f => [f.name, f]));
    for (const file of list) {
      const localContent = await archive.text(file.path);
      const old = remote.get(file.name);
      let same = false;
      if (old) {
        // A different length proves difference without a download.
        const length = Number(old.length);
        if (!Number.isFinite(length) || length === encoder.encode(localContent).length) {
          const remoteContent = await read(t('syncComparing', type, file.name),
            () => api.problem('viewFile', id, {type, name:file.name}, {raw:true}));
          same = sameText(remoteContent, localContent);
        }
      }
      if (same) unchanged(type + ': ' + file.name);
      else await apply(t('syncSaving', type, file.name),
        () => api.problem('saveFile', id, {type, name:file.name, file:localContent}));
    }
  }

  const remoteSolutions = new Map((target?.solutions || []).map(s => [s.name, s]));
  const wantedMain = plan.solutions.find(s => s.tag === 'MA');
  const previousMain = (target?.solutions || []).find(s => s.tag === 'MA');
  if (wantedMain && previousMain && previousMain.name !== wantedMain.name) {
    // saveSolution(tag=MA) is rejected while another solution has that tag.
    // Demote the old main without deleting its content; obsolete solutions
    // are removed only after the new main has been uploaded successfully.
    const retained = plan.solutions.find(s => s.name === previousMain.name);
    const tag = retained?.tag ?? 'OK';
    const original = await read(t('syncCheckingPreviousMainSolution', previousMain.name),
      () => api.problem('viewSolution', id, {name:previousMain.name}, {raw:true}));
    if (typeof original !== 'string' || !original.length)
      throw Error(t('syncCannotReadPreviousMainSolutionBeforeChanging', previousMain.name));
    await apply(t('syncUpdatingPreviousMainSolutionTag', previousMain.name),
      () => api.problem('saveSolution', id, {name:previousMain.name, tag, file:original}));
    remoteSolutions.set(previousMain.name, {...previousMain, tag});
  }
  for (const solution of plan.solutions) {
    const old = remoteSolutions.get(solution.name);
    const localContent = await archive.text(solution.path);
    let same = false;
    if (old) {
      const length = Number(old.length);
      if (!Number.isFinite(length) || length === encoder.encode(localContent).length) {
        const content = await read(t('syncComparingSolution', solution.name),
          () => api.problem('viewSolution', id, {name:solution.name}, {raw:true}));
        same = sameText(content, localContent);
      }
    }
    const tagDiff = !old || old.tag !== solution.tag;
    if (same && !tagDiff) unchanged(t('syncSolution', solution.name));
    else await apply(t('syncSavingSolution', solution.name), () => api.problem('saveSolution', id, {
      name:solution.name, file:localContent, ...(tagDiff ? {tag:solution.tag} : {})
    }));
  }
}

export async function deleteObsoleteFiles({api, id, plan, target, apply}) {
  const fileTypes = packageFiles(plan);
  // Drop only truly obsolete files after replacing references.
  if (target) {
    for (const [type, list, key] of fileTypes) {
      const wanted = new Set(list.map(x => x.name));
      const protectedFiles = new Set(type === 'resource' ?
        ['olymp.sty', 'problem.tex', 'statements.ftl'] : []);
      for (const file of target.files?.[key] || []) {
        if (!wanted.has(file.name) && !protectedFiles.has(file.name))
          await apply(t('syncDeletingOldFile', type, file.name),
            () => api.problem('deleteFile', id, {type, name:file.name}));
      }
    }
    for (const old of target.solutions || []) if (!plan.solutions.some(s => s.name === old.name))
      await apply(t('syncDeletingPreviousSolution', old.name),
        () => api.problem('deleteSolution', id, {name:old.name}));
  }
}
