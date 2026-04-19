import { useState, useEffect } from 'react';

const SEB_SERVER_URL = import.meta.env.VITE_SEB_SERVER_URL || 'http://localhost:4000';
/** Default for the Access token field — user input overrides at submit time. */
const DEFAULT_ACCESS_TOKEN =
  import.meta.env.VITE_ACCESS_TOKEN ||
  import.meta.env.VITE_ORG_ACCESS_TOKEN ||
  import.meta.env.VITE_ORG_SLUG ||
  'none';
/** Optional — only for manual .mapr download when register-launch fails (GET /api/org-config with ORG_CONFIG_REQUIRE_CLIENT_PROOF). */
/** Candidate/session-specific launch URL — same contract as real LMS (deep link, signed URL, etc.) */
const DEFAULT_LAUNCH_URL =
  import.meta.env.VITE_LAUNCH_URL || import.meta.env.VITE_EXAM_URL || '';
/** Catalog assessment id — any string; must match Exam.clientAssessmentId in seb-server when set */
const DEFAULT_CLIENT_ASSESSMENT_ID =
  import.meta.env.VITE_CLIENT_ASSESSMENT_ID || import.meta.env.VITE_EXAM_ID || 'none-direct-exam';
/** Must match the assessment title stored in seb-server for this org */
const DEFAULT_ASSESSMENT_NAME =
  import.meta.env.VITE_ASSESSMENT_NAME || import.meta.env.VITE_EXAM_NAME || 'Direct Exam';
const DEFAULT_SECURITY_TEMPLATE =
  String(import.meta.env.VITE_SECURITY_TEMPLATE || 'standard').toLowerCase() === 'strict' ? 'strict' : 'standard';
/** Wire enum for register-launch: `TEST` → exam session, `INTERVIEW` → interview session (seb-server maps to exam|interview). */
const rawAssessmentKind = String(import.meta.env.VITE_ASSESSMENT_TYPE || 'TEST').trim().toUpperCase();
const DEFAULT_ASSESSMENT_KIND = rawAssessmentKind === 'INTERVIEW' ? 'INTERVIEW' : 'TEST';
const MOBILE_PROCTOR_HEARTBEAT_MS = 8000;
const MOBILE_PROCTOR_CHUNK_MS = 5000;

function decodeJwtPayload(token) {
  try {
    const [, payload = ''] = String(token || '').split('.');
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function AppShell({ pageTitle, pageDesc, children }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <p className="app-header-kicker">Acting as LMS</p>
          <h1 className="app-header-title">{pageTitle}</h1>
          {pageDesc ? <p className="app-header-desc">{pageDesc}</p> : null}
        </div>
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">
        Mock LMS — local integration test for MA-Proctoring and backend service.
      </footer>
    </div>
  );
}

function MobileProctorStandalone({ launchTicketId }) {
  const [status, setStatus] = useState('Loading launch ticket...');
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [heartbeatMissedCount, setHeartbeatMissedCount] = useState(0);
  const [heartbeatWarning, setHeartbeatWarning] = useState('');
  const [networkOnline, setNetworkOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [serverReachable, setServerReachable] = useState(true);
  const videoRef = useState(() => ({ current: null }))[0];
  const streamRef = useState(() => ({ current: null }))[0];
  const recorderRef = useState(() => ({ current: null }))[0];
  const sessionIdRef = useState(() => ({ current: '' }))[0];
  const chunkSeqRef = useState(() => ({ current: 0 }))[0];
  const finalizedRef = useState(() => ({ current: false }))[0];
  const sebBaseUrl = SEB_SERVER_URL.replace(/\/$/, '');

  useEffect(() => {
    function goOnline() { setNetworkOnline(true); }
    function goOffline() { setNetworkOnline(false); }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function boot() {
      if (!launchTicketId) {
        setError('Invalid link: missing launch ticket id.');
        setStatus('');
        return;
      }
      try {
        const res = await fetch(`${sebBaseUrl}/api/v1/proctor/mobile/checkin/${launchTicketId}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || 'Failed to load launch link');
        if (!alive) return;
        setInfo(payload);
        setStatus('Ready. Keep your phone camera facing you and your laptop screen.');
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Failed to load launch link');
        setStatus('');
      }
    }
    void boot();
    return () => { alive = false; };
  }, [launchTicketId, sebBaseUrl]);

  useEffect(() => () => {
    try { recorderRef.current?.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [recorderRef, streamRef]);

  useEffect(() => {
    function sendKeepalive(url, payload) {
      const body = JSON.stringify(payload || {});
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
        return;
      }
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }

    function flushPresenceOnExit() {
      const sessionId = sessionIdRef.current;
      if (!sessionId || finalizedRef.current) return;
      sendKeepalive(`${sebBaseUrl}/api/v1/proctor/mobile/heartbeat/${sessionId}`, {
        missedCount: heartbeatMissedCount,
        source: 'page-exit',
      });
      if (isRecording) {
        sendKeepalive(`${sebBaseUrl}/api/v1/proctor/mobile/finish/${sessionId}`, { source: 'page-exit' });
        finalizedRef.current = true;
      }
    }

    window.addEventListener('pagehide', flushPresenceOnExit);
    window.addEventListener('beforeunload', flushPresenceOnExit);
    return () => {
      window.removeEventListener('pagehide', flushPresenceOnExit);
      window.removeEventListener('beforeunload', flushPresenceOnExit);
    };
  }, [sebBaseUrl, heartbeatMissedCount, isRecording, sessionIdRef, finalizedRef]);

  useEffect(() => {
    if (!isRecording || !sessionIdRef.current) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const resp = await fetch(`${sebBaseUrl}/api/v1/proctor/mobile/heartbeat/${sessionIdRef.current}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ missedCount: heartbeatMissedCount }),
          });
          if (!resp.ok) throw new Error('Heartbeat failed');
          const body = await resp.json();
          setServerReachable(true);
          if (body?.warning) setHeartbeatWarning(String(body.warning));
        } catch {
          setServerReachable(false);
          setHeartbeatMissedCount((n) => n + 1);
          setHeartbeatWarning('Network unstable: heartbeat missing. Recording continues, keep this page open.');
        }
      })();
    }, MOBILE_PROCTOR_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [isRecording, heartbeatMissedCount, sebBaseUrl, sessionIdRef]);

  async function startRecording() {
    try {
      setError('');
      setStatus('Starting mobile proctoring...');
      const sessionResp = await fetch(`${sebBaseUrl}/api/v1/proctor/mobile/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchTicketId }),
      });
      const sessionPayload = await sessionResp.json();
      if (!sessionResp.ok) throw new Error(sessionPayload?.error || 'Unable to start proctoring session');
      sessionIdRef.current = String(sessionPayload.sessionId);

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: true,
        });
      } catch (mediaErr) {
        // Some devices/browsers fail to initialize microphone in mobile web views.
        // Fall back to video-only recording so proctoring can still continue.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        setHeartbeatWarning(
          `Microphone unavailable (${mediaErr?.message || 'audio init failed'}). Continuing with video-only recording.`
        );
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunkSeqRef.current = 0;

      recorder.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0 || !sessionIdRef.current) return;
        const fd = new FormData();
        fd.append('chunk', ev.data, `chunk-${chunkSeqRef.current}.webm`);
        fd.append('sequence', String(chunkSeqRef.current));
        fd.append('clientTimestamp', String(Date.now()));
        chunkSeqRef.current += 1;
        const up = await fetch(`${sebBaseUrl}/api/v1/proctor/mobile/upload/${sessionIdRef.current}`, {
          method: 'POST',
          body: fd,
        });
        if (up.ok) {
          setServerReachable(true);
          setUploadedCount((c) => c + 1);
        } else {
          setServerReachable(false);
        }
      };

      recorder.start(MOBILE_PROCTOR_CHUNK_MS);
      setIsRecording(true);
      finalizedRef.current = false;
      setHeartbeatMissedCount(0);
      setHeartbeatWarning('');
      setServerReachable(true);
      setStatus('Recording started. Keep this page open until exam ends.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start recording');
      setStatus('');
    }
  }

  async function stopRecording() {
    try {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setIsRecording(false);
      if (sessionIdRef.current) {
        await fetch(`${sebBaseUrl}/api/v1/proctor/mobile/heartbeat/${sessionIdRef.current}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ missedCount: heartbeatMissedCount, source: 'manual-stop' }),
        });
        await fetch(`${sebBaseUrl}/api/v1/proctor/mobile/finish/${sessionIdRef.current}`, { method: 'POST' });
        finalizedRef.current = true;
      }
      setStatus('Recording stopped.');
      setHeartbeatWarning(
        'Warning: If exam is still running in MA-Proctoring and recording stays off for 30 seconds, the candidate will be flagged as suspected.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop recording');
    }
  }

  return (
    <div className="proctor-page">
      <p className="card-lead" style={{ marginTop: 0 }}>
        Place your phone so your face and laptop screen are both visible.
      </p>
      <div className="proctor-meta">
        <strong>Network:</strong> {networkOnline ? 'Online' : 'Offline'}
        {' · '}
        <strong>Server:</strong> {serverReachable ? 'Reachable' : 'Unreachable'}
      </div>
      {info && (
        <div className="card" style={{ padding: '1rem 1.15rem' }}>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            <strong>Candidate:</strong> {info.candidateEmail}
            <br />
            <strong>Assessment:</strong> {info.assessmentName} ({info.clientAssessmentId})
          </p>
        </div>
      )}
      {status && <div className="proctor-banner proctor-banner--ok">{status}</div>}
      {error && <div className="proctor-banner proctor-banner--err">{error}</div>}
      {heartbeatWarning && (
        <div className="proctor-banner proctor-banner--warn">
          {heartbeatWarning} (missed: {heartbeatMissedCount})
        </div>
      )}
      <video
        ref={(el) => { videoRef.current = el; }}
        autoPlay
        muted
        playsInline
        className="proctor-video"
      />
      <p className="proctor-chunk">Uploaded chunks: {uploadedCount}</p>
      {!isRecording ? (
        <button type="button" className="btn btn-primary" onClick={startRecording}>
          Start recording
        </button>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={stopRecording}>
          Stop recording
        </button>
      )}
    </div>
  );
}

function LmsStartPage() {
  const [token, setToken] = useState(() => localStorage.getItem('authToken'));
  const [userId, setUserId] = useState('');
  const [username, setUsername] = useState('student');
  const [password, setPassword] = useState('pass123');
  const [status, setStatus] = useState('');
  const [examStatus, setExamStatus] = useState('');
  const [fallbackDownload, setFallbackDownload] = useState(null);
  const [candidateEmail, setCandidateEmail] = useState('');
  const [accessToken, setAccessToken] = useState(DEFAULT_ACCESS_TOKEN);
  const [launchUrl, setLaunchUrl] = useState(DEFAULT_LAUNCH_URL);
  const [clientAssessmentId, setClientAssessmentId] = useState(DEFAULT_CLIENT_ASSESSMENT_ID);
  const [assessmentName, setAssessmentName] = useState(DEFAULT_ASSESSMENT_NAME);
  const [securityTemplate, setSecurityTemplate] = useState(DEFAULT_SECURITY_TEMPLATE);
  /** `TEST` | `INTERVIEW` — sent as register-launch `assessmentType` (seb-server normalizes to exam|interview). */
  const [assessmentKind, setAssessmentKind] = useState(DEFAULT_ASSESSMENT_KIND);
  const [consentGiven, setConsentGiven] = useState(false);
  /** Separate from examStatus so the button never stays disabled if status text gets stuck */
  const [isStartingSeb, setIsStartingSeb] = useState(false);

  // Check if we're on /exam page
  useEffect(() => {
    const isExamPage = window.location.pathname === '/exam';
    const params = new URLSearchParams(window.location.search);
    const examToken = params.get('token');

    if (isExamPage && examToken) {
      validateAndShowExam(examToken);
      return;
    }
  }, []);

  async function validateAndShowExam(examToken) {
    try {
      const payload = decodeJwtPayload(examToken);
      setUserId(payload?.userId || payload?.sub || 'candidate');
      setStatus('valid');
    } catch {
      setStatus('error');
    }
  }

  async function login(e) {
    e?.preventDefault();
    try {
      const nextUserId = username.trim() || 'student';
      const nextToken = `mock-session-${Date.now()}`;
      setToken(nextToken);
      setUserId(nextUserId);
      localStorage.setItem('authToken', nextToken);
      setStatus('Logged in as ' + nextUserId);
    } catch (e) {
      setStatus('Error: ' + e.message);
    }
  }

  async function startExam(e) {
    e?.preventDefault();
    if (!accessToken?.trim()) {
      setExamStatus('Please enter the access token (org token for backend service).');
      return;
    }
    if (!candidateEmail?.trim()) {
      setExamStatus('Please enter your email.');
      return;
    }
    if (!launchUrl?.trim()) {
      setExamStatus('Please enter the launch URL for this attempt (LMS deep link).');
      return;
    }
    if (!clientAssessmentId?.trim()) {
      setExamStatus('Please enter your LMS catalog assessment id (opaque string your product uses).');
      return;
    }
    if (!assessmentName?.trim()) {
      setExamStatus('Please enter the assessment display name — must match the title configured in backend service for this org.');
      return;
    }
    if (!consentGiven) {
      setExamStatus('Please agree to the data collection terms (checkbox above).');
      return;
    }
    setIsStartingSeb(true);
    setExamStatus('Downloading and opening MA-Proctoring...');
    setFallbackDownload(null);
    const effectiveAccessToken = accessToken.trim();
    const sebBaseUrl = SEB_SERVER_URL.replace(/\/$/, '');
    const registerUrl = `${sebBaseUrl}/api/v1/register-launch`;
    const bareOrgConfigUrl = `${sebBaseUrl}/api/v1/org-config/${encodeURIComponent(effectiveAccessToken)}`;
    const payload = {
      email: candidateEmail.trim(),
      accessToken: effectiveAccessToken,
      launchUrl: launchUrl.trim(),
      clientAssessmentId: clientAssessmentId.trim(),
      assessmentName: assessmentName.trim(),
      assessmentType: assessmentKind,
      securityTemplate,
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    let registerData = {};
    let orgConfigFetchUrl = '';
    try {
      const registerRes = await fetch(registerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const registerText = await registerRes.text();
      try {
        registerData = registerText ? JSON.parse(registerText) : {};
      } catch {
        registerData = { error: registerText || 'Unknown response from backend service' };
      }
      if (!registerRes.ok) {
        const hint = registerData.hint || '';
        setExamStatus(
          (registerData.error || registerData.message || 'Failed to register launch.') +
          (hint ? ' ' + hint : '') +
          ' — Or download manually: '
        );
        setFallbackDownload({ url: bareOrgConfigUrl });
        return;
      }

      const proctorRequired = Boolean(registerData?.proctoring?.required);

      orgConfigFetchUrl =
        typeof registerData.orgConfigUrl === 'string' && registerData.orgConfigUrl.trim()
          ? registerData.orgConfigUrl.trim()
          : '';
      if (!orgConfigFetchUrl && registerData.launchTicketId) {
        const u = new URL(bareOrgConfigUrl);
        u.searchParams.set('launchTicketId', String(registerData.launchTicketId));
        u.searchParams.set('clientAssessmentId', clientAssessmentId.trim());
        orgConfigFetchUrl = u.toString();
      }
      if (!orgConfigFetchUrl) {
        setExamStatus(
          'Launch registered but the backend did not return orgConfigUrl or launchTicketId — cannot download the configuration file. Update backend.'
        );
        setFallbackDownload({ url: bareOrgConfigUrl });
        setIsStartingSeb(false);
        return;
      }

      triggerBackendDownload(orgConfigFetchUrl);
      if (proctorRequired) {
        setExamStatus(
          'Launch registered and .mapr downloaded. Open the file in MA-Proctoring — strict proctoring continues inside MA-Proctoring (mobile / QR when the exam session starts). Candidate will be flagged if mobile proctoring stays offline for 30 seconds.'
        );
      } else {
        setExamStatus('Launch registered on backend service and configuration file downloaded. Open the downloaded file in MA-Proctoring.');
      }
    } catch (e) {
      const aborted = e?.name === 'AbortError';
      setExamStatus(
        aborted
          ? 'Request timed out or was cancelled. Is backend service running on port 4000?'
          : 'Error: ' + e.message + ' — Ensure backend service is reachable on port 4000. Or download manually:'
      );
      if (orgConfigFetchUrl) {
        setFallbackDownload({ url: orgConfigFetchUrl });
      } else {
        setFallbackDownload({ url: bareOrgConfigUrl });
      }
    } finally {
      clearTimeout(timeoutId);
      setIsStartingSeb(false);
    }
  }

  function triggerBackendDownload(downloadUrl) {
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  // Exam page view (when /exam?token=...)
  const params = new URLSearchParams(window.location.search);
  const examToken = params.get('token');
  const isExamPage = window.location.pathname === '/exam' && examToken;

  if (isExamPage) {
    return (
      <AppShell
        pageTitle="Exam session"
        pageDesc="Validated after launch in MA-Proctoring."
      >
        <div className="exam-page">
          <div className="exam-card">
            <h1>Exam access</h1>
            {status === 'valid' && (
              <p className="text-success">
                Exam started for user <strong>{userId}</strong>
              </p>
            )}
            {status === 'invalid' && (
              <p className="text-error">
                Validation failed (403). Open from MA-Proctoring or use the Start test flow.
              </p>
            )}
            {status === 'error' && <p className="text-error">Validation error.</p>}
            {!status && <p style={{ color: 'var(--text-muted)' }}>Validating…</p>}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      pageTitle="Start exam in MA-Proctoring"
      pageDesc="Register a launch on backend service, download the configuration file, and open the exam in MA-Proctoring instead of a regular browser."
    >
      <div className="card">
        <h2 className="card-title">Sign in</h2>
        <p className="card-lead">Mock credentials — any username and password are accepted.</p>
        <form onSubmit={login}>
          <div className="form-group">
            <label className="form-label" htmlFor="lms-username">
              Username
            </label>
            <input
              id="lms-username"
              className="input"
              type="text"
              placeholder="student"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lms-password">
              Password
            </label>
            <input
              id="lms-password"
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block">
            Sign in
          </button>
        </form>
        {status && (
          <p className={`login-status${status.startsWith('Logged in') ? ' ok' : ''}`}>
            {status}
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">Start test</h2>
        <p className="card-lead">Connects to <strong>{SEB_SERVER_URL}</strong> and starts MA-Proctoring for this attempt.</p>
        <form onSubmit={startExam}>
          <div className="form-group">
            <label className="form-label" htmlFor="lms-access-token">
              Access token (org)
            </label>
            <input
              id="lms-access-token"
              className="input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. none or your org access token"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lms-email">
              Candidate email
            </label>
            <input
              id="lms-email"
              className="input"
              type="email"
              placeholder="you@example.com"
              value={candidateEmail}
              onChange={(e) => setCandidateEmail(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lms-launch-url">
              Launch URL (this attempt only)
            </label>
            <input
              id="lms-launch-url"
              className="input"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="https://your-lms/…/attempt-specific-link"
              value={launchUrl}
              onChange={(e) => setLaunchUrl(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lms-client-assessment-id">
              Client assessment id
            </label>
            <input
              id="lms-client-assessment-id"
              className="input"
              type="text"
              placeholder="e.g. course-2026-bio-A"
              value={clientAssessmentId}
              onChange={(e) => setClientAssessmentId(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lms-assessment-name">
              Assessment name
            </label>
            <input
              id="lms-assessment-name"
              className="input"
              type="text"
              placeholder="Must match title in backend service"
              value={assessmentName}
              onChange={(e) => setAssessmentName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lms-assessment-type">
              Assessment type
            </label>
            <select
              id="lms-assessment-type"
              className="input"
              value={assessmentKind}
              onChange={(e) => setAssessmentKind(e.target.value)}
            >
              <option value="TEST">Test (proctored written / timed assessment)</option>
              <option value="INTERVIEW">Interview (live or structured interview flow)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lms-security-template">
              Security template
            </label>
            <select
              id="lms-security-template"
              className="input"
              value={securityTemplate}
              onChange={(e) => setSecurityTemplate(e.target.value)}
            >
              <option value="standard">Standard (desktop MA-Proctoring monitoring)</option>
              <option value="strict">Strict (includes required mobile / secondary camera proctoring)</option>
            </select>
          </div>
          {securityTemplate === 'strict' ? (
            <p className="form-hint" style={{ marginTop: 0 }}>
              Strict includes mobile (secondary camera) proctoring; follow the steps in MA-Proctoring after opening the .mapr.
            </p>
          ) : null}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={(e) => setConsentGiven(e.target.checked)}
            />
            <span>
              I agree that process data, session logs, and monitoring information may be collected for exam integrity.
            </span>
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={isStartingSeb}>
            {isStartingSeb ? 'Starting…' : 'Start test'}
          </button>
        </form>
        <div
          role="status"
          aria-live="polite"
          className={`status-area${examStatus.startsWith('Please') ? ' is-warning' : ''}`}
        >
          {examStatus}
        </div>
        {fallbackDownload?.url && (
          <button
            type="button"
            className="link-download"
            onClick={() => triggerBackendDownload(fallbackDownload.url)}
          >
            Retry / download .mapr manually
          </button>
        )}
        {fallbackDownload?.message && (
          <p className="form-hint" style={{ marginTop: '0.75rem' }}>
            {fallbackDownload.message}
          </p>
        )}
      </div>

      {token && <div className="session-pill">Signed in as session user</div>}
    </AppShell>
  );
}

function App() {
  const mobilePathMatch = window.location.pathname.match(/^\/mobile-proctor\/([^/]+)/);
  const mobileLaunchTicketId = mobilePathMatch ? decodeURIComponent(mobilePathMatch[1]) : '';
  if (mobileLaunchTicketId) {
    return (
      <AppShell
        pageTitle="Mobile proctor check-in"
        pageDesc="Use your phone camera while the exam runs in MA-Proctoring on the laptop."
      >
        <MobileProctorStandalone launchTicketId={mobileLaunchTicketId} />
      </AppShell>
    );
  }
  return <LmsStartPage />;
}

export default App;
