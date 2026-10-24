import assert from 'node:assert/strict';
import {
  encryptCredentials, decryptCredentials, normalizeCredentials, sameVaultRecord
} from '../credential-vault.js';

const credentials = { key: 'SECRET_API_KEY_DO_NOT_STORE', secret: 'SECRET_API_SECRET_DO_NOT_STORE' };
const passphrase = 'correct horse battery stable 2026';
const one = await encryptCredentials(credentials, passphrase);
const two = await encryptCredentials(credentials, passphrase);
assert.equal(one.version, 1);
assert.equal(one.cipher, 'AES-256-GCM');
assert.equal(one.iterations, 600000);
assert.notEqual(one.salt, two.salt);
assert.notEqual(one.iv, two.iv);
assert.notEqual(one.ciphertext, two.ciphertext);
assert(!JSON.stringify(one).includes(credentials.key));
assert(!JSON.stringify(one).includes(credentials.secret));
assert.deepEqual(await decryptCredentials(one, passphrase), credentials);
const shuffled = Object.fromEntries(Object.entries(one).reverse());
assert.notEqual(JSON.stringify(shuffled), JSON.stringify(one), 'fixture must change property order');
assert(sameVaultRecord(one, shuffled), 'same encrypted record must compare equal across Chrome serialization');
assert.deepEqual(await decryptCredentials(shuffled, passphrase), credentials);
assert(!sameVaultRecord(one, two), 'different ciphertext must remain distinguishable');
assert(!sameVaultRecord(one, {...shuffled, ciphertext: 'altered'}));
assert(!sameVaultRecord(one, {...shuffled, extra: 'unexpected'}));
assert(!sameVaultRecord(one, null));
assert(sameVaultRecord(null, null));
console.log('PASS: vault record equality ignores object key order and preserves encrypted v1 compatibility');
await assert.rejects(() => decryptCredentials(one, 'incorrect horse'), /일치하지 않거나/);
await assert.rejects(() => encryptCredentials(credentials, 'too-short'), /최소 12자/);
const tampered = { ...one, ciphertext: one.ciphertext.replace(/^./, x => x === 'A' ? 'B' : 'A') };
await assert.rejects(() => decryptCredentials(tampered, passphrase), /일치하지 않거나/);
await assert.rejects(() => decryptCredentials({ ...one, iterations: 1 }, passphrase), /읽을 수 없는/);
assert.deepEqual(normalizeCredentials({ key: ' a ', secret: ' b ', pin: ' 1234 ' }), {key:'a',secret:'b'});
console.log('PASS: AES-256-GCM vault encryption, randomized IV/salt, tampering and wrong-passphrase protection');
