import { t } from '../i18n.js';
import { readZipDirectory } from './zip-directory.js';
import { ZipContents } from './zip-contents.js';
export const MAX_ZIP_SIZE = 100 * 1024 * 1024;

// A job owns its archive and must dispose it. Names/metadata remain available
// during a job; cached decompression can be discarded between upload and build.
export class ZipArchive {
  static async fromFile(file, options = {}) {
    options.signal?.throwIfAborted();
    if (!file || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_ZIP_SIZE)
      throw Error(t('zipArchiveTooLarge'));
    const buffer = await readFileBuffer(file, options.signal);
    options.signal?.throwIfAborted();
    return new ZipArchive(buffer, options);
  }

  constructor(buffer, {cacheLimit, signal} = {}) {
    signal?.throwIfAborted();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > MAX_ZIP_SIZE)
      throw Error(t('zipArchiveTooLarge'));
    const {entries, root} = readZipDirectory(buffer);
    this.entries = entries; this.root = root;
    this.contents = new ZipContents(buffer, cacheLimit);
    this.signal = signal; this.onAbort = () => this.dispose();
    signal?.addEventListener('abort', this.onAbort, {once:true});
  }

  get buffer() { return this.contents.buffer; }
  get cacheBytes() { return this.contents.cacheBytes; }
  get pending() { return this.contents.pending; }
  clearCache() { this.contents.clearCache(); }
  dispose() {
    this.signal?.removeEventListener('abort', this.onAbort);
    this.contents.dispose(); this.entries.clear();
  }
  path(path) {
    this.contents.checkOpen();
    if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || path.split('/').includes('..'))
      throw Error(t('zipInvalidPackagePath', path));
    return this.root + path.replace(/^(\.\/)+/, '');
  }
  has(path) { return this.entries.has(this.path(path)); }
  names() {
    this.contents.checkOpen();
    return [...this.entries.keys()].filter(name => name.startsWith(this.root)).map(name => name.slice(this.root.length));
  }
  async read(path) {
    const name = this.path(path), entry = this.entries.get(name);
    if (!entry) throw Error(t('zipMissingFileInPackage', path));
    return this.contents.read(name, entry, path);
  }
  async bytes(path) {
    return (await this.read(path)).bytes.slice();
  }
  async text(path) {
    const value = await this.read(path);
    this.contents.checkOpen();
    if (value.text === null) {
      value.text = new TextDecoder('utf-8', {fatal:true}).decode(value.bytes).replace(/^\ufeff/, '');
      this.contents.remember(this.path(path), value);
    }
    return value.text;
  }
}

// File.arrayBuffer() cannot be interrupted. A native File/Blob stream can be
// cancelled immediately when a popup selects another file or closes.
async function readFileBuffer(file, signal) {
  if (typeof file.stream !== 'function') {
    const buffer = await file.arrayBuffer();
    signal?.throwIfAborted();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size)
      throw Error(t('zipFileSizeMismatch'));
    return buffer;
  }
  const reader = file.stream().getReader();
  const abort = () => {reader.cancel(signal.reason).catch(() => {});};
  signal?.addEventListener('abort', abort, {once:true});
  try {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(file.size);
    let offset = 0;
    for (;;) {
      const {done, value} = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (offset + value.byteLength > bytes.length) throw Error(t('zipFileSizeMismatch'));
      bytes.set(value, offset); offset += value.byteLength;
    }
    if (offset !== bytes.length) throw Error(t('zipFileSizeMismatch'));
    return bytes.buffer;
  } catch (error) {await reader.cancel().catch(() => {}); throw error;}
  finally {signal?.removeEventListener('abort', abort); reader.releaseLock();}
}
