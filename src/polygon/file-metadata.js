import { canonicalResource, apiResource, apiSourceType } from '../package/metadata.js';
import { filesSnapshot, namedSnapshot } from './snapshot.js';
import { t } from '../i18n.js';

// Compare server metadata, not just the submitted source bytes. Unknown compiler
// IDs must fail explicitly rather than being accepted under a default compiler.
export async function verifyFileMetadata({api, id, plan, read, changed = null}) {
  if (![...plan.sources, ...plan.solutions].some(file => file.sourceType) &&
      !plan.resources.some(file => Object.hasOwn(file, 'resourceAdvancedProperties'))) return;
  const checkFiles = (!changed || changed.files) &&
    (plan.sources.length > 0 || plan.resources.some(file => Object.hasOwn(file, 'resourceAdvancedProperties')));
  const checkSolutions = (!changed || changed.solutions) && plan.solutions.length > 0;
  let files = {sourceFiles:[], resourceFiles:[], auxFiles:[]}, solutions = [];
  if (checkFiles) files = filesSnapshot(await read(t('formatVerifyFiles'), () => api.problem('files', id)));
  if (checkSolutions) solutions = namedSnapshot(await read(t('formatVerifySolutions'), () => api.problem('solutions', id)));
  for (const [wanted, actual] of [[checkFiles ? plan.sources : [], files.sourceFiles], [checkSolutions ? plan.solutions : [], solutions]]) {
    const byName = new Map(actual.map(file => [file.name, file]));
    for (const file of wanted) {
      const saved = byName.get(file.name);
      if (!saved || (file.sourceType && saved.sourceType !== apiSourceType(file.sourceType)))
        throw Error(t('formatSourceTypeMismatch', file.name, apiSourceType(file.sourceType) || ''));
    }
  }
  const resources = new Map(files.resourceFiles.map(file => [file.name, file]));
  for (const file of checkFiles ? plan.resources : []) {
    if (!Object.hasOwn(file, 'resourceAdvancedProperties')) continue;
    const saved = resources.get(file.name);
    if (!saved || JSON.stringify(canonicalResource(saved.resourceAdvancedProperties)) !==
        JSON.stringify(apiResource(file.resourceAdvancedProperties)))
      throw Error(t('formatResourceMismatch', file.name));
  }
}
