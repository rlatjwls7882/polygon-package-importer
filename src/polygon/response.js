// Limit all response bodies while reading. Checking a length after text()/blob()
// has already consumed an unbounded stream cannot prevent excessive allocation.
export const RESPONSE_LIMITS = Object.freeze({
  jsonBytes:256 * 1024 * 1024, rawBytes:128 * 1024 * 1024, errorBytes:64 * 1024
});

export async function discardResponse(response) {
  if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
}

async function consume(response, maxBytes, tooLarge, accept) {
  const declared = response.headers.get('content-length');
  if (declared != null && Number(declared) > maxBytes) {
    await discardResponse(response); throw Error(tooLarge);
  }
  const reader = response.body?.getReader();
  if (!reader) return false;
  let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw Error(tooLarge);
      accept(value);
    }
    return true;
  } catch (error) {
    await reader.cancel().catch(() => {}); throw error;
  } finally {reader.releaseLock();}
}

export async function readBinary(response, maxBytes, tooLarge) {
  const chunks = [];
  if (await consume(response, maxBytes, tooLarge, chunk => chunks.push(chunk)))
    return new Blob(chunks, {type:response.headers.get('content-type') || ''});
  const blob = await response.blob();
  if (blob.size > maxBytes) throw Error(tooLarge);
  return blob;
}

export async function readText(response, maxBytes, tooLarge) {
  const decoder = new TextDecoder();
  let text = '';
  if (await consume(response, maxBytes, tooLarge, chunk => {text += decoder.decode(chunk, {stream:true});}))
    return text + decoder.decode();
  // Null-body Responses and minimal test transports have no readable stream.
  text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw Error(tooLarge);
  return text;
}
