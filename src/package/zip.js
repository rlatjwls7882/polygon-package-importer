import { t } from '../i18n.js';
// Dependency-free, read-only ZIP parser for Chrome 103+. No ZIP extraction to disk.
// Deliberately rejects encrypted, ZIP64, split and suspicious archives.
const dec = new TextDecoder('utf-8');
const MAX_ENTRIES = 5000, MAX_TOTAL = 512 * 1024 * 1024, MAX_SINGLE = 128 * 1024 * 1024;
const MAX_RATIO = 2500;
export const MAX_ZIP_SIZE = 100 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;

export class ZipArchive {
  static async fromFile(file) {
    if (!file || !Number.isFinite(file.size) || file.size < 0 || file.size > MAX_ZIP_SIZE)
      throw Error(t('zipArchiveTooLarge'));
    return new ZipArchive(await file.arrayBuffer());
  }

  constructor(buffer, {cacheLimit = MAX_CACHE_BYTES} = {}) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > MAX_ZIP_SIZE)
      throw Error(t('zipArchiveTooLarge'));
    this.cacheLimit = Math.max(0, Math.min(MAX_CACHE_BYTES, cacheLimit));
    this.cache = new Map();
    this.pending = new Map();
    this.cacheBytes = 0;
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
      if (p + 46 > cdStart + cdSize || this.u32(p) !== 0x02014b50) throw Error(t('zipZipEntryListIsCorrupted'));
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
        if (offset + 30 > cdStart || this.u32(offset) !== 0x04034b50)
          throw Error(t('zipInvalidZipLocalHeader', name));
        const dataStart = offset + 30 + this.u16(offset + 26) + this.u16(offset + 28);
        if (dataStart + compressed > cdStart) throw Error(t('zipZipDataIsOutOfBounds', name));
        this.entries.set(name, { name, method, compressed, size, crc, dataStart });
      }
      p += 46 + nameLen + extra + comment;
    }
    const roots = [...this.entries.keys()].filter(x => x === 'problem.xml' || x.endsWith('/problem.xml'));
    if (roots.length !== 1) throw Error(t('zipZipMustContainExactlyOneProblemXml'));
    this.root = roots[0].slice(0, -'problem.xml'.length);
  }

  bounds(i, size) {
    if (!Number.isSafeInteger(i) || i < 0 || i + size > this.dv.byteLength)
      throw Error(t('zipZipEntryListIsOutOfBounds'));
  }
  u16(i) { this.bounds(i, 2); return this.dv.getUint16(i, true); }
  u32(i) { this.bounds(i, 4); return this.dv.getUint32(i, true); }
  path(p) {
    if (typeof p !== 'string' || p.includes('\\') || p.startsWith('/') || p.split('/').includes('..'))
      throw Error(t('zipInvalidPackagePath', p));
    return this.root + p.replace(/^(\.\/)+/, '');
  }
  has(p) { return this.entries.has(this.path(p)); }
  names() { return [...this.entries.keys()].filter(x => x.startsWith(this.root)).map(x => x.slice(this.root.length)); }
  remember(name, value) {
    const previous = this.cache.get(name);
    if (previous) this.cacheBytes -= previous.weight;
    this.cache.delete(name);
    value.weight = value.bytes.length + (value.text?.length || 0) * 2;
    if (value.weight > this.cacheLimit) return;
    this.cache.set(name, value);
    this.cacheBytes += value.weight;
    while (this.cacheBytes > this.cacheLimit) {
      const oldest = this.cache.keys().next().value;
      this.cacheBytes -= this.cache.get(oldest).weight;
      this.cache.delete(oldest);
    }
  }

  async inflate(entry, path) {
    const compressed = new Uint8Array(this.buffer, entry.dataStart, entry.compressed);
    let bytes;
    if (entry.method === 0) {
      if (compressed.length !== entry.size) throw Error(t('zipDecompressedSizeMismatch', path));
      bytes = new Uint8Array(compressed);
    } else {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader();
      bytes = new Uint8Array(entry.size);
      let offset = 0;
      try {
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          if (offset + value.length > entry.size) throw Error(t('zipDecompressedSizeMismatch', path));
          bytes.set(value, offset);
          offset += value.length;
        }
        if (offset !== entry.size) throw Error(t('zipDecompressedSizeMismatch', path));
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
    }
    if (crc32(bytes) !== entry.crc) throw Error(t('zipCrc32CheckFailed', path));
    return {bytes, text:null, weight:0};
  }

  async read(path) {
    const name = this.path(path), entry = this.entries.get(name);
    if (!entry) throw Error(t('zipMissingFileInPackage', path));
    if (this.cache.has(name)) {
      const value = this.cache.get(name);
      this.cache.delete(name);
      this.cache.set(name, value);
      return value;
    }
    if (!this.pending.has(name)) {
      const pending = this.inflate(entry, path).then(value => {
        this.remember(name, value);
        return value;
      }).finally(() => this.pending.delete(name));
      this.pending.set(name, pending);
    }
    return this.pending.get(name);
  }

  async bytes(path) {
    // Callers must not be able to corrupt data already checked by CRC32.
    return (await this.read(path)).bytes.slice();
  }

  async text(path) {
    const value = await this.read(path);
    if (value.text === null) {
      value.text = new TextDecoder('utf-8', {fatal:true}).decode(value.bytes).replace(/^\ufeff/, '');
      this.remember(this.path(path), value);
    }
    return value.text;
  }

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
