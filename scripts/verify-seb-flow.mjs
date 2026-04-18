/**
 * End-to-end API check (no SEB GUI): register-launch → oauth → handshake → configuration
 * Run: node scripts/verify-seb-flow.mjs
 * Requires: seb-server on 4000. Mock LMS frontend is optional.
 */
const SEB = process.env.SEB_SERVER_URL || 'http://localhost:4000';
const ACCESS_TOKEN =
  process.env.ACCESS_TOKEN || process.env.ORG_ACCESS_TOKEN || process.env.ORG_SLUG || 'none';
const EMAIL = process.env.TEST_EMAIL || 'verify-flow@test.local';
const LAUNCH_URL =
  process.env.TEST_LAUNCH_URL ||
  process.env.TEST_EXAM_URL ||
  'http://localhost:5173/exam?token=verify-placeholder';
const CLIENT_ASSESSMENT_ID = process.env.CLIENT_ASSESSMENT_ID || process.env.CLIENT_EXAM_ID || 'none-direct-exam';
const ASSESSMENT_NAME = process.env.ASSESSMENT_NAME || process.env.CLIENT_EXAM_NAME || 'Direct Exam';
const SUBSCRIPTION_PLAN = (process.env.TEST_SUBSCRIPTION_PLAN || '').trim();

async function main() {
  const out = [];

  const reg = await fetch(`${SEB}/api/v1/register-launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: EMAIL,
      accessToken: ACCESS_TOKEN,
      launchUrl: LAUNCH_URL,
      clientAssessmentId: CLIENT_ASSESSMENT_ID,
      assessmentName: ASSESSMENT_NAME,
      assessmentType: process.env.ASSESSMENT_TYPE || 'TEST',
      ...(SUBSCRIPTION_PLAN ? { subscriptionPlan: SUBSCRIPTION_PLAN } : {}),
    }),
  });
  const regBody = await reg.json().catch(() => ({}));
  out.push({ step: 'register-launch', ok: reg.ok, status: reg.status, body: regBody });
  if (!reg.ok) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const basic = Buffer.from(
    'none-client:ee29dea7f54dae6bfcb8e46f4534a604fa2a8bc09f377c4c61821034baaa9acb'
  ).toString('base64');
  const tok = await fetch(`${SEB}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  });
  const tokJson = await tok.json();
  out.push({ step: 'oauth', ok: tok.ok, status: tok.status });
  if (!tok.ok) {
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const access = tokJson.access_token;
  const hs = await fetch(`${SEB}/handshake`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const exams = await hs.json();
  const first = Array.isArray(exams) ? exams[0] : null;
  const catalogId = first?.clientAssessmentId ?? first?.examId;
  out.push({ step: 'handshake-list-exams', ok: hs.ok, clientAssessmentId: catalogId });

  const patch = await fetch(`${SEB}/handshake`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientAssessmentId: catalogId,
      candidateEmail: EMAIL,
    }),
  });
  out.push({ step: 'handshake-patch', ok: patch.ok, status: patch.status });

  const cfg = await fetch(`${SEB}/configuration?clientAssessmentId=${encodeURIComponent(catalogId)}`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  const ct = cfg.headers.get('content-type') || '';
  out.push({
    step: 'configuration',
    ok: cfg.ok,
    status: cfg.status,
    contentType: ct,
    isPlist: ct.includes('plist') || ct.includes('apple'),
  });
  if (!cfg.ok) {
    const errBody = await cfg.json().catch(() => ({}));
    out[out.length - 1].error = errBody;
  }

  console.log(JSON.stringify(out, null, 2));
  if (!cfg.ok || !out[out.length - 1].isPlist) {
    process.exit(1);
  }
  console.log('\nOK: full chain returns configuration plist.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
