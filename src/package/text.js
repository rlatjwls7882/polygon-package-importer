// Polygon text uploads normalize CRLF/CR to LF for comparison. Scan instead
// of materializing normalized copies, UTF-8 buffers, or arrays of every line.
export function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a === b) return true;
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    let x = a.charCodeAt(i++), y = b.charCodeAt(j++);
    if (x === 13) {x = 10;if (a.charCodeAt(i) === 10) i++;}
    if (y === 13) {y = 10;if (b.charCodeAt(j) === 10) j++;}
    if (x !== y) return false;
  }
  return i === a.length && j === b.length;
}

export function textByteRange(text) {
  let bytes = 0, lines = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 13 || code === 10) {
      if (code === 13 && text.charCodeAt(i + 1) === 10) i++;
      bytes++;lines++;
    } else if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff &&
        text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;i++;
    } else bytes += 3; // A lone surrogate is encoded as U+FFFD by TextEncoder.
  }
  return {min:bytes, max:bytes + lines};
}
