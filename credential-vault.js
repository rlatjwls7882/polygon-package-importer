// A local-only encrypted vault. Never store API credentials in plaintext or chrome.storage.sync.
// Chrome storage.local is NOT encrypted by Chrome. The passphrase is deliberately not stored.
export const STORE_KEY = 'polygonEncryptedCredentialsV1';
const VAULT_FIELDS = Object.freeze(['version', 'kdf', 'iterations', 'cipher', 'salt', 'iv', 'ciphertext']);

// Chrome storage can serialize object keys in a different order. Never use
// JSON.stringify() as a vault equality check: serialization order isn't data.
export function sameVaultRecord(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b))
    return false;
  if (Object.keys(a).length !== VAULT_FIELDS.length ||
      Object.keys(b).length !== VAULT_FIELDS.length) return false;
  return VAULT_FIELDS.every(field =>
    Object.hasOwn(a, field) && Object.hasOwn(b, field) && a[field] === b[field]);
}
const ITERATIONS = 600_000;
const AAD = new TextEncoder().encode('polygon-package-importer/credentials/v1');
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function encode64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function decode64(value, expectedLength = null) {
  if (typeof value !== 'string' || value.length > 32768 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw Error('저장된 인증 데이터의 형식이 올바르지 않습니다.');
  const result = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (expectedLength !== null && result.length !== expectedLength)
    throw Error('저장된 인증 데이터가 손상되었습니다.');
  return result;
}

export function normalizeCredentials({ key, secret }) {
  // Older credential records may contain extra fields. Only Key and Secret
  // are used for new API requests and newly saved credentials.
  if (typeof key !== 'string' || typeof secret !== 'string')
    throw Error('API 인증 정보를 문자열로 입력하세요.');
  const value = { key: key.trim(), secret: secret.trim() };
  if (!value.key || !value.secret) throw Error('API Key와 Secret을 모두 입력하세요.');
  if ([value.key, value.secret].some(s => s.length > 4096))
    throw Error('API 인증 정보가 지나치게 깁니다.');
  return value;
}

function validatePassphrase(passphrase, firstUse = false) {
  if (typeof passphrase !== 'string' || passphrase.length > 1024)
    throw Error('보관함 암호가 올바르지 않습니다.');
  if (firstUse && (Array.from(passphrase).length < 12 || !passphrase.trim()))
    throw Error('보관함 암호는 최소 12자 이상으로 설정하세요.');
}

async function deriveKey(passphrase, salt) {
  const passwordKey = await crypto.subtle.importKey('raw', encoder.encode(passphrase),
    'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    passwordKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function encryptCredentials(credentials, passphrase) {
  const value = normalizeCredentials(credentials);
  validatePassphrase(passphrase, true);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const data = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, data);
  data.fill(0); // Best effort. JavaScript strings cannot be reliably zeroed.
  return { version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS,
    cipher: 'AES-256-GCM', salt: encode64(salt), iv: encode64(iv),
    ciphertext: encode64(new Uint8Array(ciphertext)) };
}

export async function decryptCredentials(record, passphrase) {
  validatePassphrase(passphrase);
  if (!record || record.version !== 1 || record.kdf !== 'PBKDF2-SHA256' ||
      record.iterations !== ITERATIONS || record.cipher !== 'AES-256-GCM')
    throw Error('이 버전에서 읽을 수 없는 보관함입니다. 기존 값을 확인한 뒤 새로 등록하세요.');
  try {
    const salt = decode64(record.salt, 16);
    const iv = decode64(record.iv, 12);
    const ciphertext = decode64(record.ciphertext);
    if (ciphertext.length < 17 || ciphertext.length > 32768)
      throw Error('인증 데이터 길이가 올바르지 않습니다.');
    const key = await deriveKey(passphrase, salt);
    const plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, ciphertext));
    const parsed = JSON.parse(decoder.decode(plain));
    plain.fill(0);
    return normalizeCredentials(parsed);
  } catch {
    throw Error('보관함 암호가 일치하지 않거나 저장된 데이터가 손상되었습니다.');
  }
}
