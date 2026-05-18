import crypto from 'crypto';
import express from 'express';

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
