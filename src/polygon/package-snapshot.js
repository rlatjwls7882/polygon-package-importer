import { ZipArchive } from '../package/zip.js';
import { loadPolygonPackage } from '../package/load.js';
import { resolveXmlText, ATTR } from '../package/xml.js';
import { packages, validId, successfulComment } from './verification/packages.js';
import { boolean } from './compare.js';
import { t } from '../i18n.js';
const decoder = new TextDecoder('utf-8', {fatal:true});

// An attempt-local comparison source, never a cached verification result. The
// caller rechecks the working-copy revision before using any comparisons to write.
export async function readPackageSnapshot(api, id, entry, emit = async () => {}) {
  if (entry.modified !== false || !validId(entry.revision) ||
      (entry.workingCopyRevision != null && Number(entry.workingCopyRevision) !== Number(entry.revision))) return null;
  await emit(t('snapshotReading'));
  let archive;
  try {
    const candidates = packages(await api.problem('packages', id)).filter(pkg =>
      Number(pkg.revision) === Number(entry.revision) && pkg.state === 'READY' &&
      (pkg.type == null || pkg.type === 'standard') && successfulComment(pkg.comment));
    const selected = candidates.sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (!selected) return null;
    const blob = await api.problem('package', id, {packageId:selected.id, type:'standard'}, {binary:true});
    archive = await ZipArchive.fromFile(blob);
    if (Number(ATTR(resolveXmlText(await archive.text('problem.xml')), 'revision')) !== Number(entry.revision))
      throw Error('Snapshot revision mismatch');
    const plan = await loadPolygonPackage(archive);
    if (plan.unsupported.length) throw Error('Unsupported snapshot');
    return new PackageSnapshot(archive, plan);
  } catch (error) {
    archive?.dispose();
    api.checkOpen?.();
    if (error?.name === 'AbortError') throw error;
    await emit(t('snapshotFallback'));
    return null;
  }
}

class PackageSnapshot {
  constructor(archive, plan) {
    this.archive = archive;
    this.files = new Map();
    for (const [type, list] of [['source',plan.sources], ['resource',plan.resources],
      ['aux',plan.aux], ['solution',plan.solutions]])
      for (const file of list) this.files.set(type + ':' + file.name, file.path);
    this.tests = new Map(plan.tests.map(test => [test.index, test]));
    this.tags = new Map(plan.solutions.map(solution => [solution.name, solution.extraTags]));
    this.checkerPercent = plan.checkerPercent;
  }

  file(type, name) {
    const path = this.files.get(type + ':' + name);
    return path === undefined ? undefined : this.text(path);
  }

  async text(path) {
    // Match API response/inputBase64 decoding. ZipArchive.text also removes an
    // extra leading BOM, which could hide a real remote-content difference.
    return decoder.decode(await this.archive.bytes(path));
  }

  async addInputs(tests, wanted) {
    const indices = new Set(wanted.filter(test => test.method === 'manual').map(test => test.index));
    const needed = tests.filter(test => boolean(test.manual) && indices.has(Number(test.index)));
    if (needed.some(test => this.tests.get(Number(test.index))?.method !== 'manual' ||
        !this.tests.get(Number(test.index))?.path)) return false;
    for (const test of needed) test.input = await this.text(this.tests.get(Number(test.index)).path);
    return true;
  }

  extraTags(name) { return this.tags.get(name); }

  invalidate(method, args) {
    if (method === 'saveFile' || method === 'deleteFile') this.files.delete(args.type + ':' + args.name);
    if (method === 'saveSolution' || method === 'deleteSolution') {
      this.files.delete('solution:' + args.name);
      this.tags.delete(args.name);
    }
    // Group deletion/recreation can remove extra tags as a side effect.
    if (['clearScript','saveScript','deleteTest','setTestGroup'].includes(method) ||
        (method === 'saveTest' && Object.hasOwn(args, 'testGroup'))) this.tags.clear();
    if (method === 'enablePoints') this.checkerPercent = undefined;
  }

  dispose() {
    this.archive.dispose();
    this.files.clear(); this.tests.clear(); this.tags.clear();
  }
}
