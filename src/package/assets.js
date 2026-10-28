import { sameText } from './text.js';
import { TAGS, readSourceType, readResourceProperties, canonicalResource, readExtraTags } from './metadata.js';
import { t } from '../i18n.js';
import { CHILD, CHILDREN, ATTR, KIND_DESC } from './xml.js';
const basename = p => p.split('/').pop();
const validPolygonFileName = name => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name);
const textDecoder = new TextDecoder('utf-8', {fatal:true});

// Polygon stores solutions in one flat namespace, although ZIPs may have
// separate directories with identically named verification sources.
export function resolveDuplicateSolutionNames(solutions) {
  const counts = new Map(), used = new Set(), paths = new Set();
  for (const solution of solutions) {
    if (paths.has(solution.path)) throw Error(t('syncZipContainsSolutionsWithDuplicateNames'));
    paths.add(solution.path);
    const key = solution.name.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
    used.add(key);
  }

  const duplicates = solutions.filter(solution => counts.get(solution.name.toLowerCase()) > 1)
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const solution of duplicates) {
    // Renaming Main.java can make an otherwise valid public Java class fail to compile.
    if (solution.name.toLowerCase().endsWith('.java') ||
        /^java(?:[.0-9]|$)/i.test(solution.sourceType || ''))
      throw Error(t('syncZipContainsSolutionsWithDuplicateNames'));

    const dot = solution.name.lastIndexOf('.');
    const stem = dot > 0 ? solution.name.slice(0, dot) : solution.name;
    const extension = dot > 0 ? solution.name.slice(dot) : '';
    const parents = solution.path.split('/').slice(0, -1).reverse();
    let chosen = '';
    for (let depth = 1; depth <= parents.length; depth++) {
      const hint = parents.slice(0, depth).reverse()
        .map(part => part.replace(/[^A-Za-z0-9_.-]+/g, '-')).join('-');
      const candidate = stem + '-' + hint + extension;
      if (candidate.length <= 120 && validPolygonFileName(candidate) &&
          !used.has(candidate.toLowerCase())) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      // For very long/unusual parent paths, fall back to a stable path hash.
      let hash = 2166136261;
      for (const codepoint of solution.path)
        hash = Math.imul(hash ^ codepoint.codePointAt(0), 16777619) >>> 0;
      const suffix = hash.toString(16).padStart(8, '0');
      for (let index = 0; index < 10000 && !chosen; index++) {
        const ending = '-' + suffix + (index ? '-' + index : '') + extension;
        const candidate = stem.slice(0, Math.max(1, 120 - ending.length)) + ending;
        if (validPolygonFileName(candidate) && !used.has(candidate.toLowerCase()))
          chosen = candidate;
      }
    }
    if (!chosen) throw Error(t('syncZipContainsSolutionsWithDuplicateNames'));
    solution.name = chosen;
    used.add(chosen.toLowerCase());
  }
}

export async function readAssets(root, archive, plan) {
  const sourceByName = new Map(plan.sources.map(file => [file.name, file]));
  const resourceByName = new Map(plan.resources.map(file => [file.name, file]));
  const validators = CHILDREN(CHILD(CHILD(root, 'assets'), 'validators'), 'validator');
  if (validators.length > 1) throw Error(t('formatMultipleValidators'));
  function addSource(src) {
    if (!src) return '';
    const path = ATTR(src, 'path');
    const name = basename(path);
    if (!path || !archive.has(path)) throw Error(t('modelMissingSourceFile', path || t('modelNoPath')));
    const sourceType = readSourceType(src);
    const existing = sourceByName.get(name);
    if (existing && (existing.path !== path || existing.sourceType !== sourceType)) throw Error(t('modelDifferentSourceFilesShareTheSameName', name));
    if (!existing) {
      const file = {name, path, sourceType};
      plan.sources.push(file); sourceByName.set(name, file);
    }
    return name;
  }
  const assets = CHILD(root, 'assets');
  for (const e of CHILDREN(CHILD(CHILD(root, 'files'), 'executables'), 'executable'))
    addSource(CHILD(e, 'source'));
  for (const [kind, xmlTag] of [['checker','checker'], ['validator','validator'], ['interactor','interactor']]) {
    const desc = KIND_DESC(assets, xmlTag);
    if (!desc) continue;
    const src = CHILD(desc, 'source');
    const standard = kind === 'checker' && ATTR(desc, 'name').startsWith('std::');
    plan[kind] = standard ? ATTR(desc, 'name') : src ? addSource(src) : '';
  }
  const files = CHILD(root, 'files');
  // Polygon exports can repeat the same bundled header under several paths.
  // Polygon itself uses a flat resource namespace, so merge only identical files.
  for (const f of CHILDREN(CHILD(files, 'resources'), 'file')) {
    const path = ATTR(f, 'path');
    if (!path || !archive.has(path)) throw Error(t('modelMissingResource', path));
    const name = basename(path);
    if (name === '.checker-selection-v1') {
      // SOJ packages attach this private marker when a built-in checker is
      // selected. It is not a Polygon resource and its name is rejected by
      // problem.saveFile. Do not skip arbitrary hidden resources.
      const parts = (await archive.text(path)).trimEnd().split('\t');
      const folder = path.match(/^files\/soj-checkers\/([0-9a-f]{64})\/\.checker-selection-v1$/);
      const valid = folder && parts.length === 5 &&
        parts[0] === 'SOJ-CHECKER-SELECTION' && parts[1] === '1' &&
        parts[2] === 'builtin' && /^[a-z0-9_-]+$/.test(parts[3]) &&
        parts[4] === folder[1] &&
        (plan.checker === `std::${parts[3]}.cpp` || plan.checker === `std::${parts[3]}`);
      if (!valid) plan.unsupported.push(t('modelCannotVerifySojCheckerSelectionMetadataCheck', path));
      continue;
    }
    if (!validPolygonFileName(name)) {
      plan.unsupported.push(t('modelInvalidResourceFilename', name, path));
      continue;
    }
    const resourceAdvancedProperties = readResourceProperties(f);
    const previous = resourceByName.get(name);
    if (previous) {
      const [before, after] = await Promise.all([archive.bytes(previous.path), archive.bytes(path)]);
      let equal = before.length === after.length && before.every((byte, i) => byte === after[i]);
      if (!equal) {
        // A package may include identical text with Windows/Unix line endings.
        try {
          equal = sameText(textDecoder.decode(before), textDecoder.decode(after));
        } catch { /* Binary resources must match byte-for-byte. */ }
      }
      if (JSON.stringify(canonicalResource(previous.resourceAdvancedProperties)) !==
          JSON.stringify(canonicalResource(resourceAdvancedProperties))) equal = false;
      if (!equal)
        plan.unsupported.push(t('modelResourceNameConflict', name, previous.path, path));
      continue;
    }
    const resource = { name, path, resourceAdvancedProperties };
    plan.resources.push(resource); resourceByName.set(name, resource);
  }
  for (const f of CHILDREN(CHILD(files, 'auxiliary-files'), 'file')) {
    const path = ATTR(f, 'path');
    if (!path || !archive.has(path)) throw Error(t('modelMissingResource', path));
    if (plan.aux.some(file => file.name === basename(path))) throw Error(t('modelResourceNameConflict', basename(path), path, path));
    plan.aux.push({ name: basename(path), path });
  }
  for (const el of CHILDREN(CHILD(assets, 'solutions'), 'solution')) {
    const src = CHILD(el, 'source'), path = ATTR(src, 'path');
    if (!path || !archive.has(path)) throw Error(t('modelMissingSolutionSource', path));
    const tag = TAGS[ATTR(el, 'tag').toLowerCase()];
    if (!tag) throw Error(t('modelUnknownSolutionTag', ATTR(el, 'tag')));
    plan.solutions.push({ name: basename(path), path, tag, sourceType:readSourceType(src), extraTags:readExtraTags(el) });
  }
  resolveDuplicateSolutionNames(plan.solutions);
  for (const file of [...plan.sources, ...plan.solutions, ...plan.aux]) {
    if (!validPolygonFileName(file.name))
      plan.unsupported.push(t('modelInvalidSourceFilename', file.name, file.path));
  }
}
