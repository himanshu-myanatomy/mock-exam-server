import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import { encryptMapr } from './mapr-pkhs.js';

const app = express();

const PORT = Number(process.env.MOCK_CLIENT_SERVER_PORT || 8787);
const SIGNING_SECRET = String(process.env.MOCK_CLIENT_SIGNING_SECRET || '').trim();

app.use(express.json({ limit: '5mb' }));

function safeString(value) {
  return String(value ?? '').trim();
}

function verifySignature(rawBody, signatureHeader) {
  if (!SIGNING_SECRET) return { verified: null, reason: 'no_server_secret_configured' };
  const sig = safeString(signatureHeader);
  if (!sig.startsWith('sha256=')) return { verified: false, reason: 'missing_or_invalid_signature_format' };
  const expected = crypto.createHmac('sha256', SIGNING_SECRET).update(rawBody).digest('hex');
  const incoming = sig.slice('sha256='.length);
  const matches = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(incoming));
  return { verified: matches, reason: matches ? 'ok' : 'signature_mismatch' };
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mock-client-server',
    signatureValidation: SIGNING_SECRET ? 'enabled' : 'disabled',
  });
});

/**
 * Stands in for what the real backend would do: take the plaintext .mapr the launch API returns
 * and re-wrap it as a public-key encrypted file the candidate can double-click. Set
 * MOCK_MAPR_CERT_PEM to a certificate whose private key is installed in the Windows cert store.
 */
app.post('/mapr/encrypt', (req, res) => {
  const certPath = safeString(process.env.MOCK_MAPR_CERT_PEM);
  if (!certPath) {
    return res.status(503).json({ ok: false, error: 'MOCK_MAPR_CERT_PEM is not set' });
  }

  const base64 = safeString(req.body?.base64);
  if (!base64) {
    return res.status(400).json({ ok: false, error: 'base64 is required' });
  }

  try {
    const encrypted = encryptMapr(Buffer.from(base64, 'base64'), fs.readFileSync(certPath, 'utf8'));
    console.log('[mock-client] mapr encrypted %d -> %d bytes', base64.length, encrypted.length);
    return res.json({ ok: true, base64: encrypted.toString('base64') });
  } catch (e) {
    console.error('[mock-client] mapr encryption failed:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/webhook/completion-report', (req, res) => {
  const eventId = safeString(req.body?.eventId || req.headers['idempotency-key'] || '');
  const bodyText = JSON.stringify(req.body || {});
  const signature = safeString(req.headers['x-ma-signature']);
  const signatureResult = verifySignature(bodyText, signature);

  console.log(
    '[mock-client] completion report received eventId=%s signature=%s',
    eventId || '(none)',
    signatureResult.verified === null ? 'not-checked' : signatureResult.verified ? 'ok' : 'failed'
  );
  console.log('[mock-client] payload=%s', bodyText);

  return res.status(200).json({
    ok: true,
    message: 'received',
  });
});

app.listen(PORT, () => {
  console.log('[mock-client] listening on http://localhost:%d', PORT);
  console.log('[mock-client] webhook endpoint: POST /webhook/completion-report');
});
