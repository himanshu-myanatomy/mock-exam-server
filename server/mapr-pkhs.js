/**
 * Public-key ("pkhs") encryption for .mapr files, matching what MA Proctoring decrypts in
 * SafeExamBrowser.Configuration/Cryptography/PublicKeyEncryption.cs:
 *
 *   "pkhs" | SHA1(cert public key raw bytes) [20B] | RSA-PKCS1 blocks of the whole payload
 *
 * The client finds the matching private key in the Windows certificate store and decrypts with
 * no prompt, which is the whole point: an encrypted file the candidate can double-click.
 */
import crypto from 'crypto';

const PREFIX = 'pkhs';
const PUBLIC_KEY_HASH_SIZE = 20;

/**
 * SEB hashes `certificate.PublicKey.EncodedKeyValue.RawData` — the raw RSAPublicKey (PKCS#1)
 * bytes, *not* the SubjectPublicKeyInfo wrapper that PEM export gives you.
 */
function publicKeyHash(certPem) {
  const pkcs1 = crypto.createPublicKey(certPem).export({ type: 'pkcs1', format: 'der' });
  return crypto.createHash('sha1').update(pkcs1).digest();
}

export function encryptMapr(plainBuffer, certPem) {
  const key = crypto.createPublicKey(certPem);
  const blockSize = key.asymmetricKeyDetails.modulusLength / 8;
  const chunkSize = blockSize - 11; // PKCS1 v1.5 padding overhead
  const blocks = [];

  for (let offset = 0; offset < plainBuffer.length; offset += chunkSize) {
    const chunk = plainBuffer.subarray(offset, offset + chunkSize);
    blocks.push(crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, chunk));
  }

  return Buffer.concat([Buffer.from(PREFIX, 'utf8'), publicKeyHash(certPem), ...blocks]);
}

/** Mirrors the client's decrypt, so the round-trip can be asserted without Windows. */
export function decryptMapr(encryptedBuffer, privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const blockSize = key.asymmetricKeyDetails.modulusLength / 8;
  const body = encryptedBuffer.subarray(PREFIX.length + PUBLIC_KEY_HASH_SIZE);
  const plain = [];

  for (let offset = 0; offset < body.length; offset += blockSize) {
    const block = body.subarray(offset, offset + blockSize);
    plain.push(crypto.privateDecrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, block));
  }

  return Buffer.concat(plain);
}
