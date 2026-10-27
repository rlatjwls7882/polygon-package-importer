import { canonicalResource } from '../package/metadata.js';
import { t } from '../i18n.js';
import { sameText } from './compare.js';
import { textByteRange } from '../package/text.js';

function mayMatchLength(length, text) {
  const remote = Number(length);
  if (length == null || !Number.isFinite(remote)) return true;
  const {min, max} = textByteRange(text);
  // An EOL-equivalent remote file may use one or two bytes per line break.
  return remote >= min && remote <= max;
}

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
        if (mayMatchLength(old.length, localContent)) {
          const remoteContent = await read(t('syncComparing', type, file.name),
            () => api.problem('viewFile', id, {type, name:file.name}, {raw:true}));
          same = sameText(remoteContent, localContent);
        }
      }
      const props = {type, name:file.name};
      if (!same) props.file = localContent;
      if (type === 'source' && file.sourceType && old?.sourceType !== file.sourceType)
        props.sourceType = file.sourceType;
      if (type === 'resource' && Object.hasOwn(file, 'resourceAdvancedProperties') &&
          JSON.stringify(canonicalResource(old?.resourceAdvancedProperties)) !==
          JSON.stringify(canonicalResource(file.resourceAdvancedProperties))) {
        const advanced = file.resourceAdvancedProperties;
        if (advanced) Object.assign(props, {forTypes:advanced.forTypes,
          stages:advanced.stages.join(';'), assets:advanced.assets.join(';')});
        else props.forTypes = ''; // Documented way to remove grader linkage.
      }
      if (Object.keys(props).length === 2) unchanged(type + ': ' + file.name);
      else await apply(t('syncSaving', type, file.name), () => api.problem('saveFile', id, props));
    }
  }

  let requiresSolutionFile = false;
  async function saveSolution(props, original) {
    if (Object.hasOwn(props, 'file')) return api.problem('saveSolution', id, props);
    if (!requiresSolutionFile) {
      try { return await api.problem('saveSolution', id, props); }
      catch (error) {
        // Some Polygon deployments reject the documented tag-only edit. Fall
        // back only on this explicit pre-write validation, never on timeouts.
        if (!/^(?:problem\.saveSolution:\s*)?file:\s*Field should not be empty\.?$/i.test(String(error?.message).trim()))
          throw error;
        requiresSolutionFile = true;
      }
    }
    const file = await original();
    if (typeof file !== 'string' || !file.length) throw Error(t('syncSolutionSourceUnavailable', props.name));
    return api.problem('saveSolution', id, {...props, file});
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
    await apply(t('syncUpdatingPreviousMainSolutionTag', previousMain.name),
      () => saveSolution({name:previousMain.name, tag}, () =>
        read(t('syncComparingSolution', previousMain.name),
          () => api.problem('viewSolution', id, {name:previousMain.name}, {raw:true}))));
    remoteSolutions.set(previousMain.name, {...previousMain, tag});
  }
  for (const solution of plan.solutions) {
    const old = remoteSolutions.get(solution.name);
    const localContent = await archive.text(solution.path);
    let same = false, remoteContent;
    if (old) {
      if (mayMatchLength(old.length, localContent)) {
        remoteContent = await read(t('syncComparingSolution', solution.name),
          () => api.problem('viewSolution', id, {name:solution.name}, {raw:true}));
        same = sameText(remoteContent, localContent);
      }
    }
    const tagDiff = !old || old.tag !== solution.tag;
    const typeDiff = solution.sourceType && old?.sourceType !== solution.sourceType;
    if (same && !tagDiff && !typeDiff) unchanged(t('syncSolution', solution.name));
    else await apply(t('syncSavingSolution', solution.name), () => saveSolution({
      name:solution.name, ...(!same ? {file:localContent} : {}), ...(tagDiff ? {tag:solution.tag} : {}),
      ...(typeDiff ? {sourceType:solution.sourceType} : {})
    }, () => remoteContent));
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

// Compare server metadata, not just the submitted source bytes. Unknown compiler
// IDs must fail explicitly rather than being accepted under a default compiler.
export async function verifyFileMetadata({api, id, plan, read}) {
  if (![...plan.sources, ...plan.solutions].some(file => file.sourceType) &&
      !plan.resources.some(file => Object.hasOwn(file, 'resourceAdvancedProperties'))) return;
  const [files, solutions] = await Promise.all([
    read(t('formatVerifyFiles'), () => api.problem('files', id)),
    read(t('formatVerifySolutions'), () => api.problem('solutions', id))
  ]);
  if (!files || !Array.isArray(files.sourceFiles) || !Array.isArray(files.resourceFiles) || !Array.isArray(solutions))
    throw Error(t('formatMetadataMismatch'));
  for (const [wanted, actual] of [[plan.sources, files.sourceFiles], [plan.solutions, solutions]]) {
    const byName = new Map(actual.map(file => [file.name, file]));
    for (const file of wanted) {
      const saved = byName.get(file.name);
      if (!saved || (file.sourceType && saved.sourceType !== file.sourceType))
        throw Error(t('formatSourceTypeMismatch', file.name, file.sourceType || ''));
    }
  }
  const resources = new Map(files.resourceFiles.map(file => [file.name, file]));
  for (const file of plan.resources) {
    if (!Object.hasOwn(file, 'resourceAdvancedProperties')) continue;
    const saved = resources.get(file.name);
    if (!saved || JSON.stringify(canonicalResource(saved.resourceAdvancedProperties)) !==
        JSON.stringify(canonicalResource(file.resourceAdvancedProperties)))
      throw Error(t('formatResourceMismatch', file.name));
  }
}
