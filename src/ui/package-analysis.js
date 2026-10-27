import { ZipArchive } from '../package/zip.js';
import { loadPolygonPackage } from '../package/load.js';

export function createPackageAnalysis() {
  let active = null;
  return {
    cancel() { active?.abort(); active = null; },
    async analyze(file) {
      this.cancel();
      const controller = new AbortController(); active = controller;
      let archive;
      try {
        archive = await ZipArchive.fromFile(file, {signal:controller.signal});
        const plan = await loadPolygonPackage(archive);
        controller.signal.throwIfAborted();
        return plan;
      } finally {
        archive?.dispose();
        if (active === controller) active = null;
      }
    }
  };
}
