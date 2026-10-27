// A rejected response must be consumed or cancelled before its request slot is
// released. A ZIP limit checked after response.blob() is too late to bound I/O.
export async function discardResponse(response) {
  if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
}

export async function readBinary(response, maxBytes, tooLarge) {
  const declared = response.headers.get('content-length');
  if (declared != null && Number(declared) > maxBytes) {
    await discardResponse(response); throw Error(tooLarge);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw Error(tooLarge);
    return blob;
  }
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw Error(tooLarge);
      chunks.push(value);
    }
    return new Blob(chunks, {type:response.headers.get('content-type') || ''});
  } catch (error) {
    await reader.cancel().catch(() => {}); throw error;
  } finally { reader.releaseLock(); }
}
