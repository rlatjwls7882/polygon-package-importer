// Dependency-free, read-only ZIP parser for Chrome 103+. No ZIP extraction to disk.
// Deliberately rejects encrypted, ZIP64, split and suspicious archives.
const dec = new TextDecoder('utf-8');
const MAX_ENTRIES = 5000, MAX_TOTAL = 512 * 1024 * 1024, MAX_SINGLE = 128 * 1024 * 1024;
const MAX_RATIO = 2500;

export class ZipArchive {
  static async fromFile(file) {
    if (!file || file.size > 768 * 1024 * 1024) throw Error('ZIP 최대 크기는 768MB입니다.');
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
    if (eocd < 0) throw Error('올바른 ZIP 중앙 디렉터리를 찾지 못했습니다.');
    if (this.u16(eocd + 4) !== 0 || this.u16(eocd + 6) !== 0 ||
        this.u16(eocd + 8) !== this.u16(eocd + 10)) throw Error('분할 ZIP은 지원하지 않습니다.');
    const count = this.u16(eocd + 10), cdSize = this.u32(eocd + 12), cdStart = this.u32(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff)
      throw Error('ZIP64 형식은 지원하지 않습니다.');
    if (count > MAX_ENTRIES) throw Error(`파일 수 제한 ${MAX_ENTRIES}개 초과`);
    if (cdStart + cdSize > eocd) throw Error('ZIP 중앙 디렉터리가 손상되었습니다.');
    this.entries = new Map();
    let p = cdStart, total = 0;
    for (let i = 0; i < count; i++) {
      if (this.u32(p) !== 0x02014b50) throw Error('ZIP 파일 목록이 손상되었습니다.');
      const flags = this.u16(p + 8), method = this.u16(p + 10);
      const crc = this.u32(p + 16), compressed = this.u32(p + 20), size = this.u32(p + 24);
      const nameLen = this.u16(p + 28), extra = this.u16(p + 30), comment = this.u16(p + 32);
      const offset = this.u32(p + 42);
      if ((flags & 1) || ![0,8].includes(method)) throw Error('암호화 또는 미지원 압축 방식입니다.');
      if (p + 46 + nameLen + extra + comment > cdStart + cdSize) throw Error('ZIP 파일 목록 범위 오류');
      const original = dec.decode(b.slice(p + 46, p + 46 + nameLen));
      const name = original.replaceAll('\\', '/').replace(/^(\.\/)+/, '');
      if (name.startsWith('/') || name.includes('\0') || name.split('/').some(x => x === '..') || /^[A-Z]:/i.test(name))
        throw Error(`위험한 ZIP 경로: ${name}`);
      if (name && !name.endsWith('/')) {
        if (this.entries.has(name)) throw Error(`중복 ZIP 경로: ${name}`);
        if (size > MAX_SINGLE || (compressed < 1 && size) || (compressed > 0 && size / compressed > MAX_RATIO))
          throw Error(`압축 해제 크기가 비정상적입니다: ${name}`);
        total += size;
        if (total > MAX_TOTAL) throw Error('압축 해제 총량이 512MB를 초과합니다.');
        if (offset + 30 > b.length || this.u32(offset) !== 0x04034b50)
          throw Error(`ZIP 로컬 헤더 오류: ${name}`);
        const dataStart = offset + 30 + this.u16(offset + 26) + this.u16(offset + 28);
        if (dataStart + compressed > b.length) throw Error(`압축 데이터 범위 오류: ${name}`);
        this.entries.set(name, { name, method, compressed, size, crc, dataStart });
      }
      p += 46 + nameLen + extra + comment;
    }
    const roots = [...this.entries.keys()].filter(x => x === 'problem.xml' || x.endsWith('/problem.xml'));
    if (roots.length !== 1) throw Error('ZIP에는 단일 문제의 problem.xml이 정확히 한 개 있어야 합니다. 대회 ZIP은 지원하지 않습니다.');
    this.root = roots[0].slice(0, -'problem.xml'.length);
  }

  u16(i) { return this.dv.getUint16(i, true); }
  u32(i) { return this.dv.getUint32(i, true); }
  path(p) {
    if (typeof p !== 'string' || p.includes('\\') || p.startsWith('/') || p.split('/').includes('..'))
      throw Error(`올바르지 않은 패키지 경로: ${p}`);
    return this.root + p.replace(/^(\.\/)+/, '');
  }
  has(p) { return this.entries.has(this.path(p)); }
  names() { return [...this.entries.keys()].filter(x => x.startsWith(this.root)).map(x => x.slice(this.root.length)); }
  async bytes(p) {
    const entry = this.entries.get(this.path(p));
    if (!entry) throw Error(`패키지 내부 파일 누락: ${p}`);
    const compressed = new Uint8Array(this.buffer, entry.dataStart, entry.compressed);
    let bytes;
    if (entry.method === 0) bytes = new Uint8Array(compressed);
    else {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (bytes.length !== entry.size) throw Error(`압축 해제 길이 오류: ${p}`);
    if (crc32(bytes) !== entry.crc) throw Error(`CRC32 검증 실패: ${p}`);
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
