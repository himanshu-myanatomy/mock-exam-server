/**
 * Self-check: node server/mapr-pkhs.test.js
 * Proves the pkhs container round-trips and that its header matches what the client parses.
 */
import assert from 'assert';
import crypto from 'crypto';
import { encryptMapr, decryptMapr } from './mapr-pkhs.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const certPem = publicKey.export({ type: 'spki', format: 'pem' });
const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

// Multi-block payload: a real .mapr is far larger than one 2048-bit RSA block.
const plain = Buffer.from('<plist>' + 'x'.repeat(5000) + '</plist>', 'utf8');
const encrypted = encryptMapr(plain, certPem);

assert.strictEqual(encrypted.subarray(0, 4).toString('utf8'), 'pkhs', 'prefix must be pkhs');
assert.strictEqual(
  encrypted.subarray(4, 24).toString('hex'),
  crypto.createHash('sha1').update(publicKey.export({ type: 'pkcs1', format: 'der' })).digest('hex'),
  'key hash must be SHA1 of the PKCS#1 public key'
);
assert.deepStrictEqual(decryptMapr(encrypted, keyPem), plain, 'round-trip must be lossless');
assert.ok(!encrypted.includes(Buffer.from('plist')), 'payload must not be readable');

console.log('mapr-pkhs OK — %d plain bytes -> %d encrypted bytes', plain.length, encrypted.length);
