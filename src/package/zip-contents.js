import { t } from '../i18n.js';
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_INFLIGHT_BYTES = 32 * 1024 * 1024;
const abortError = () => new DOMException('Archive closed', 'AbortError');

// Per-archive ownership of decompression, streams, and retained bytes. A cache
// bound alone does not limit concurrent inflations or obsolete popup analyses.
export class ZipContents {
  constructor(buffer, cacheLimit = MAX_CACHE_BYTES) {
    if (!Number.isFinite(cacheLimit) || cacheLimit < 0) throw new RangeError('Invalid ZIP cache limit');
    this.buffer = buffer;
    this.cacheLimit = Math.min(MAX_CACHE_BYTES, cacheLimit);
    this.cache = new Map(); this.pending = new Map(); this.queue = [];
    this.cacheBytes = 0; this.activeBytes = 0; this.active = 0;
    this.readers = new Set(); this.closed = false;
  }

  checkOpen() { if (this.closed) throw abortError(); }
  clearCache() { this.cache.clear(); this.cacheBytes = 0; }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.clearCache(); this.buffer = null;
    for (const task of this.queue.splice(0)) task.reject(abortError());
    for (const reader of this.readers) reader.cancel().catch(() => {});
    this.pending.clear();
  }

  remember(name, value) {
    if (this.closed) return;
    const previous = this.cache.get(name);
    if (previous) this.cacheBytes -= previous.weight;
    this.cache.delete(name);
    value.weight = value.bytes.length + (value.text?.length || 0) * 2;
    if (value.weight > this.cacheLimit) return;
    this.cache.set(name, value); this.cacheBytes += value.weight;
    while (this.cacheBytes > this.cacheLimit) {
      const oldest = this.cache.keys().next().value;
      this.cacheBytes -= this.cache.get(oldest).weight; this.cache.delete(oldest);
    }
  }

  read(name, entry, path) {
    this.checkOpen();
    if (this.cache.has(name)) {
      const value = this.cache.get(name);
      this.cache.delete(name); this.cache.set(name, value);
      return Promise.resolve(value);
    }
    if (!this.pending.has(name)) {
      const promise = new Promise((resolve, reject) => this.queue.push({name, entry, path, resolve, reject}));
      const pending = promise.finally(() => this.pending.delete(name));
      this.pending.set(name, pending); this.pump();
    }
    return this.pending.get(name);
  }

  pump() {
    while (!this.closed && this.queue.length && this.active < 2) {
      const task = this.queue[0];
      // One large entry is allowed alone. Smaller reads share a 32 MiB budget.
      if (this.active && this.activeBytes + task.entry.size > MAX_INFLIGHT_BYTES) return;
      this.queue.shift(); this.active++; this.activeBytes += task.entry.size;
      this.inflate(task.entry, task.path).then(value => {
        this.checkOpen(); this.remember(task.name, value); task.resolve(value);
      }).catch(task.reject).finally(() => {
        this.active--; this.activeBytes -= task.entry.size; this.pump();
      });
    }
  }

  async inflate(entry, path) {
    this.checkOpen();
    const compressed = new Uint8Array(this.buffer, entry.dataStart, entry.compressed);
    let bytes;
    if (entry.method === 0) {
      if (compressed.length !== entry.size) throw Error(t('zipDecompressedSizeMismatch', path));
      bytes = new Uint8Array(compressed);
    } else {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader(); this.readers.add(reader);
      let offset = 0;
      try {
        bytes = new Uint8Array(entry.size);
        for (;;) {
          this.checkOpen();
          const {done, value} = await reader.read();
          this.checkOpen();
          if (done) break;
          if (offset + value.length > entry.size) throw Error(t('zipDecompressedSizeMismatch', path));
          bytes.set(value, offset); offset += value.length;
        }
        if (offset !== entry.size) throw Error(t('zipDecompressedSizeMismatch', path));
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally { this.readers.delete(reader); reader.releaseLock(); }
    }
    this.checkOpen();
    if (crc32(bytes) !== entry.crc) throw Error(t('zipCrc32CheckFailed', path));
    return {bytes, text:null, weight:0};
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
