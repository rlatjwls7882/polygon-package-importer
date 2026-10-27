import { t } from '../i18n.js';
const dec = new TextDecoder('utf-8');
const MAX_ENTRIES = 5000, MAX_TOTAL = 512 * 1024 * 1024, MAX_SINGLE = 128 * 1024 * 1024;
const MAX_RATIO = 2500;

// Read-only metadata parser. No decompression, cache, or mutable job state.
export function readZipDirectory(buffer) {
  const view = new DataView(buffer);
  const bounds = (i, size) => {
    if (!Number.isSafeInteger(i) || i < 0 || i + size > view.byteLength)
      throw Error(t('zipZipEntryListIsOutOfBounds'));
  };
  const u16 = i => { bounds(i, 2); return view.getUint16(i, true); };
  const u32 = i => { bounds(i, 4); return view.getUint32(i, true); };
  const b = new Uint8Array(buffer);
  const min = Math.max(0, b.length - (22 + 65535));
  let eocd = -1;
  for (let i = b.length - 22; i >= min; i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === b.length) { eocd = i; break; }
  }
  if (eocd < 0) throw Error(t('zipZipCentralDirectoryNotFound'));
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 ||
      u16(eocd + 8) !== u16(eocd + 10)) throw Error(t('zipSplitZipArchivesAreUnsupported'));
  const count = u16(eocd + 10), cdSize = u32(eocd + 12), cdStart = u32(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff)
    throw Error(t('zipZip64ArchivesAreUnsupported'));
  if (count > MAX_ENTRIES) throw Error(t('zipZipHasMoreThanEntries', MAX_ENTRIES));
  if (cdStart + cdSize > eocd) throw Error(t('zipZipCentralDirectoryIsCorrupted'));
  const entries = new Map();
  let p = cdStart, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdStart + cdSize || u32(p) !== 0x02014b50) throw Error(t('zipZipEntryListIsCorrupted'));
    const flags = u16(p + 8), method = u16(p + 10);
    const crc = u32(p + 16), compressed = u32(p + 20), size = u32(p + 24);
    const nameLen = u16(p + 28), extra = u16(p + 30), comment = u16(p + 32);
    const offset = u32(p + 42);
    if ((flags & 1) || ![0,8].includes(method)) throw Error(t('zipEncryptedOrUnsupportedZipCompressionMethod'));
    if (p + 46 + nameLen + extra + comment > cdStart + cdSize) throw Error(t('zipZipEntryListIsOutOfBounds'));
    const original = dec.decode(b.slice(p + 46, p + 46 + nameLen));
    const name = original.replaceAll('\\', '/').replace(/^(\.\/)+/, '');
    if (name.startsWith('/') || name.includes('\0') || name.split('/').some(x => x === '..') || /^[A-Z]:/i.test(name))
      throw Error(t('zipUnsafeZipPath', name));
    if (name && !name.endsWith('/')) {
      if (entries.has(name)) throw Error(t('zipDuplicateZipPath', name));
      if (size > MAX_SINGLE || (compressed < 1 && size) || (compressed > 0 && size / compressed > MAX_RATIO))
        throw Error(t('zipSuspiciousDecompressedSize', name));
      total += size;
      if (total > MAX_TOTAL) throw Error(t('zipTotalDecompressedSizeExceeds512Mb'));
      if (offset + 30 > cdStart || u32(offset) !== 0x04034b50)
        throw Error(t('zipInvalidZipLocalHeader', name));
      const dataStart = offset + 30 + u16(offset + 26) + u16(offset + 28);
      if (dataStart + compressed > cdStart) throw Error(t('zipZipDataIsOutOfBounds', name));
      entries.set(name, { name, method, compressed, size, crc, dataStart });
    }
    p += 46 + nameLen + extra + comment;
  }
  const roots = [...entries.keys()].filter(x => x === 'problem.xml' || x.endsWith('/problem.xml'));
  if (roots.length !== 1) throw Error(t('zipZipMustContainExactlyOneProblemXml'));
  const root = roots[0].slice(0, -'problem.xml'.length);
  return {entries, root};
}
