import { t } from '../i18n.js';
// Dependency-free, read-only ZIP parser for Chrome 103+. No ZIP extraction to disk.
// Deliberately rejects encrypted, ZIP64, split and suspicious archives.
const dec = new TextDecoder('utf-8');
const MAX_ENTRIES = 5000, MAX_TOTAL = 512 * 1024 * 1024, MAX_SINGLE = 128 * 1024 * 1024;
const MAX_RATIO = 2500;

export class ZipArchive {
  static async fromFile(file) {
    if (!file || file.size > 768 * 1024 * 1024) throw Error(t('zipZipExceedsThe768MbSizeLimit'));
    return new ZipArchive(await file.arrayBuffer());
  }

  constructor(buffer) {
    this.buffer = buffer;
    this.dv = new DataView(buffer);
    const b = new Uint8Array(buffer);
    const min = Math.max(0, b.length - (22 + 65535));
    let eocd = -1;
    for (let i = b.length - 22; i >= min; i--) {
      if (this.u32(i) === 0x06054b50 && i + 22 + this.u16(i + 20) === b.length) { eocd = i; break; }
    }
    if (eocd < 0) throw Error(t('zipZipCentralDirectoryNotFound'));
    if (this.u16(eocd + 4) !== 0 || this.u16(eocd + 6) !== 0 ||
        this.u16(eocd + 8) !== this.u16(eocd + 10)) throw Error(t('zipSplitZipArchivesAreUnsupported'));
    const count = this.u16(eocd + 10), cdSize = this.u32(eocd + 12), cdStart = this.u32(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff)
      throw Error(t('zipZip64ArchivesAreUnsupported'));
    if (count > MAX_ENTRIES) throw Error(t('zipZipHasMoreThanEntries', MAX_ENTRIES));
    if (cdStart + cdSize > eocd) throw Error(t('zipZipCentralDirectoryIsCorrupted'));
    this.entries = new Map();
    let p = cdStart, total = 0;
    for (let i = 0; i < count; i++) {
      if (this.u32(p) !== 0x02014b50) throw Error(t('zipZipEntryListIsCorrupted'));
      const flags = this.u16(p + 8), method = this.u16(p + 10);
      const crc = this.u32(p + 16), compressed = this.u32(p + 20), size = this.u32(p + 24);
      const nameLen = this.u16(p + 28), extra = this.u16(p + 30), comment = this.u16(p + 32);
      const offset = this.u32(p + 42);
      if ((flags & 1) || ![0,8].includes(method)) throw Error(t('zipEncryptedOrUnsupportedZipCompressionMethod'));
      if (p + 46 + nameLen + extra + comment > cdStart + cdSize) throw Error(t('zipZipEntryListIsOutOfBounds'));
      const original = dec.decode(b.slice(p + 46, p + 46 + nameLen));
      const name = original.replaceAll('\\', '/').replace(/^(\.\/)+/, '');
      if (name.startsWith('/') || name.includes('\0') || name.split('/').some(x => x === '..') || /^[A-Z]:/i.test(name))
        throw Error(t('zipUnsafeZipPath', name));
      if (name && !name.endsWith('/')) {
        if (this.entries.has(name)) throw Error(t('zipDuplicateZipPath', name));
        if (size > MAX_SINGLE || (compressed < 1 && size) || (compressed > 0 && size / compressed > MAX_RATIO))
          throw Error(t('zipSuspiciousDecompressedSize', name));
        total += size;
        if (total > MAX_TOTAL) throw Error(t('zipTotalDecompressedSizeExceeds512Mb'));
        if (offset + 30 > b.length || this.u32(offset) !== 0x04034b50)
          throw Error(t('zipInvalidZipLocalHeader', name));
        const dataStart = offset + 30 + this.u16(offset + 26) + this.u16(offset + 28);
        if (dataStart + compressed > b.length) throw Error(t('zipZipDataIsOutOfBounds', name));
        this.entries.set(name, { name, method, compressed, size, crc, dataStart });
      }
      p += 46 + nameLen + extra + comment;
    }
    const roots = [...this.entries.keys()].filter(x => x === 'problem.xml' || x.endsWith('/problem.xml'));
    if (roots.length !== 1) throw Error(t('zipZipMustContainExactlyOneProblemXml'));
    this.root = roots[0].slice(0, -'problem.xml'.length);
  }

  u16(i) { return this.dv.getUint16(i, true); }
  u32(i) { return this.dv.getUint32(i, true); }
  path(p) {
    if (typeof p !== 'string' || p.includes('\\') || p.startsWith('/') || p.split('/').includes('..'))
      throw Error(t('zipInvalidPackagePath', p));
    return this.root + p.replace(/^(\.\/)+/, '');
  }
  has(p) { return this.entries.has(this.path(p)); }
  names() { return [...this.entries.keys()].filter(x => x.startsWith(this.root)).map(x => x.slice(this.root.length)); }
  async bytes(p) {
    const entry = this.entries.get(this.path(p));
    if (!entry) throw Error(t('zipMissingFileInPackage', p));
    const compressed = new Uint8Array(this.buffer, entry.dataStart, entry.compressed);
    let bytes;
    if (entry.method === 0) bytes = new Uint8Array(compressed);
    else {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (bytes.length !== entry.size) throw Error(t('zipDecompressedSizeMismatch', p));
    if (crc32(bytes) !== entry.crc) throw Error(t('zipCrc32CheckFailed', p));
    return bytes;
  }
  async text(p) { return new TextDecoder('utf-8', { fatal: true }).decode(await this.bytes(p)).replace(/^\ufeff/, ''); }
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
    let c = i;
    for (let b = 0; b < 8; b++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : (c >>> 1);
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
