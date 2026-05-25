import { useState, useEffect } from 'react';
import { PLAN_TYPE, resolvePlanType, parsePlanType } from './constants.js';

const SEB_SERVER_URL = import.meta.env.VITE_SEB_SERVER_URL || 'http://localhost:4000';
/** Default for the API key field — user input overrides at submit time. */
const DEFAULT_API_KEY =
  import.meta.env.VITE_API_KEY ||
  import.meta.env.VITE_ORG_API_KEY ||
  import.meta.env.VITE_ORG_SLUG ||
  'none';
/** Candidate/session-specific launch URL — same contract as real LMS (deep link, signed URL, etc.) */
const DEFAULT_LAUNCH_URL =
  import.meta.env.VITE_LAUNCH_URL || import.meta.env.VITE_EXAM_URL || '';
/** Catalog assessment id — any string; must match Exam.clientAssessmentId in seb-server when set */
const DEFAULT_CLIENT_ASSESSMENT_ID =
  import.meta.env.VITE_CLIENT_ASSESSMENT_ID || import.meta.env.VITE_EXAM_ID || 'none-direct-exam';
/** Must match the assessment title stored in seb-server for this org */
const DEFAULT_ASSESSMENT_NAME =
  import.meta.env.VITE_ASSESSMENT_NAME || import.meta.env.VITE_EXAM_NAME || 'Direct Exam';
const DEFAULT_SECURITY_TEMPLATE = resolvePlanType(import.meta.env.VITE_SECURITY_TEMPLATE || PLAN_TYPE.STANDARD);
/** Wire enum: form picks TEST vs INTERVIEW → calls /register-launch/test or /register-launch/interview. */
const rawAssessmentKind = String(import.meta.env.VITE_ASSESSMENT_TYPE || 'TEST').trim().toUpperCase();
const DEFAULT_ASSESSMENT_KIND = rawAssessmentKind === 'INTERVIEW' ? 'INTERVIEW' : 'TEST';
const ASSESSMENT_KIND = {
  TEST: 'TEST',
  INTERVIEW: 'INTERVIEW',
};
const FEATURE_WHITELIST_KEYS = [
  'enablePrintScreen',
  'allowScreenSharing',
  'allowMultipleDisplays',
  'allowExternalWebcam',
];

function buildFeatureWhitelistEntryFromEnv(raw) {
  const enabled = new Set(
    String(raw || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  return Object.fromEntries(FEATURE_WHITELIST_KEYS.map((key) => [key, enabled.has(key)]));
}

const DEFAULT_FEATURE_WHITELIST_ENTRY = buildFeatureWhitelistEntryFromEnv(
  import.meta.env.VITE_FEATURE_WHITELIST
);
const DEFAULT_APPLICATION_WHITELIST = String(import.meta.env.VITE_APPLICATION_WHITELIST || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

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

function LmsStartPage() {
  const [token, setToken] = useState(() => localStorage.getItem('authToken'));
  const [userId, setUserId] = useState('');
  const [username, setUsername] = useState('student');
  const [password, setPassword] = useState('pass123');
  const [status, setStatus] = useState('');
  const [examStatus, setExamStatus] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [launchUrl, setLaunchUrl] = useState(DEFAULT_LAUNCH_URL);
  const [clientAssessmentId, setClientAssessmentId] = useState(DEFAULT_CLIENT_ASSESSMENT_ID);
  const [assessmentName, setAssessmentName] = useState(DEFAULT_ASSESSMENT_NAME);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [securityTemplate, setSecurityTemplate] = useState(DEFAULT_SECURITY_TEMPLATE);
  /** `TEST` | `INTERVIEW` — selects register-launch URL path (not sent in JSON body). */
  const [assessmentKind, setAssessmentKind] = useState(DEFAULT_ASSESSMENT_KIND);
  const [featureWhitelistEntry, setFeatureWhitelistEntry] = useState(DEFAULT_FEATURE_WHITELIST_ENTRY);
  const [applicationWhitelist, setApplicationWhitelist] = useState(DEFAULT_APPLICATION_WHITELIST);
  const [allowExternalInputDevices, setAllowExternalInputDevices] = useState(true);
  const [requireWindowsLocationEnabled, setRequireWindowsLocationEnabled] = useState(false);
  const [allowNewBrowserTab, setAllowNewBrowserTab] = useState(false);
  const [restrictNavigationToAllowlist, setRestrictNavigationToAllowlist] = useState(false);
  const [websiteAllowlist, setWebsiteAllowlist] = useState([]);
  const [newApp, setNewApp] = useState('');
  const [newWebsite, setNewWebsite] = useState('');
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
    if (!apiKey?.trim()) {
      setExamStatus('Please enter the api key (org key for backend service).');
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
    const interviewWebsiteAllowlist = [...websiteAllowlist];
    const pendingInterviewWebsite = newWebsite.trim();
    if (
      assessmentKind === ASSESSMENT_KIND.INTERVIEW &&
      pendingInterviewWebsite &&
      (allowNewBrowserTab || restrictNavigationToAllowlist) &&
      !interviewWebsiteAllowlist.includes(pendingInterviewWebsite)
    ) {
      interviewWebsiteAllowlist.push(pendingInterviewWebsite);
    }
    if (
      assessmentKind === ASSESSMENT_KIND.INTERVIEW &&
      restrictNavigationToAllowlist &&
      interviewWebsiteAllowlist.length === 0
    ) {
      setExamStatus(
        'Add at least one website to the allowlist when "Restrict navigation to allowlist" is enabled.'
      );
      return;
    }
    setIsStartingSeb(true);
    setExamStatus('Downloading and opening MA-Proctoring...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
      const effectiveApiKey = apiKey.trim();
      const resolvedSecurityTemplate = parsePlanType(securityTemplate);
      if (!resolvedSecurityTemplate) {
        setExamStatus('Security template must be STANDARD or STRICT.');
        return;
      }
      const sebBaseUrl = SEB_SERVER_URL.replace(/\/$/, '');
      const registerPath =
        assessmentKind === ASSESSMENT_KIND.INTERVIEW
          ? 'register-launch/interview'
          : 'register-launch/test';
      const registerUrl = `${sebBaseUrl}/api/v1/${registerPath}`;
      const payload = {
        email: candidateEmail.trim(),
        apiKey: effectiveApiKey,
        launchUrl: launchUrl.trim(),
        clientAssessmentId: clientAssessmentId.trim(),
        assessmentName: assessmentName.trim(),
        attemptNumber: Number(attemptNumber),
        securityTemplate: resolvedSecurityTemplate,
        featureWhitelist: featureWhitelistEntry,
        applicationWhitelist,
        allowExternalInputDevices,
        requireWindowsLocationEnabled,
      };
      if (assessmentKind === ASSESSMENT_KIND.INTERVIEW) {
        payload.interviewSebSettings = {
          allowNewBrowserTab,
          restrictNavigationToAllowlist,
          websiteAllowlist: interviewWebsiteAllowlist,
        };
      }

      const registerRes = await fetch(registerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const registerText = await registerRes.text();
      let registerData = {};
      try {
        registerData = registerText ? JSON.parse(registerText) : {};
      } catch {
        registerData = { error: registerText || 'Unknown response from backend service' };
      }
      if (!registerRes.ok) {
        const hint = registerData.hint || '';
        setExamStatus(
          (registerData.error || registerData.message || 'Failed to register launch.') +
          (hint ? ' ' + hint : '')
        );
        return;
      }

      const proctorRequired = Boolean(registerData?.proctoring?.required);
      const embeddedMapr = registerData?.mapr;
      if (!embeddedMapr?.base64) {
        setExamStatus(
          'Launch registered but the backend did not return mapr — cannot download the configuration file. Update backend.'
        );
        setIsStartingSeb(false);
        return;
      }

      triggerMaprDownloadFromBase64(embeddedMapr);
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
          : 'Error: ' + e.message + ' — Ensure backend service is reachable on port 4000.'
      );
    } finally {
      clearTimeout(timeoutId);
      setIsStartingSeb(false);
    }
  }

  function triggerMaprDownloadFromBase64(mapr) {
    const base64 = String(mapr?.base64 || '').trim();
    if (!base64) return;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], {
      type: mapr.contentType || 'application/octet-stream',
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = mapr.filename || 'config.mapr';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  function toggleFeature(feature) {
    setFeatureWhitelistEntry((prev) => ({
      ...prev,
      [feature]: !prev[feature],
    }));
  }

  function addApplication() {
    const executable = newApp.trim();
    if (!executable) return;
    setApplicationWhitelist((prev) => (prev.includes(executable) ? prev : [...prev, executable]));
    setNewApp('');
  }

  function removeApplication(index) {
    setApplicationWhitelist((prev) => prev.filter((_, idx) => idx !== index));
  }

  const interviewAllowlistEditingEnabled = allowNewBrowserTab || restrictNavigationToAllowlist;

  function addWebsite() {
    const entry = newWebsite.trim();
    if (!entry || !interviewAllowlistEditingEnabled) return;
    setWebsiteAllowlist((prev) => {
      if (prev.length >= 40 || prev.includes(entry)) return prev;
      return [...prev, entry];
    });
    setNewWebsite('');
  }

  function removeWebsite(index) {
    setWebsiteAllowlist((prev) => prev.filter((_, idx) => idx !== index));
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
      pageDesc="Register a launch on backend service (one API call returns the .mapr file), then open the exam in MA-Proctoring instead of a regular browser."
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
            <label className="form-label" htmlFor="lms-api-key">
              API key (org)
            </label>
            <input
              id="lms-api-key"
              className="input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="e.g. none or your org api key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
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
            <label className="form-label" htmlFor="lms-attempt-number">
              Attempt number
            </label>
            <input
              id="lms-attempt-number"
              className="input"
              type="number"
              min={1}
              step={1}
              placeholder="1"
              value={attemptNumber}
              onChange={(e) => setAttemptNumber(Math.max(1, Number(e.target.value) || 1))}
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
              onChange={(e) => {
                const next = parsePlanType(e.target.value);
                if (next) setSecurityTemplate(next);
              }}
            >
              <option value={PLAN_TYPE.STANDARD}>Standard (desktop MA-Proctoring monitoring)</option>
              <option value={PLAN_TYPE.STRICT}>Strict (includes required mobile / secondary camera proctoring)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">SEB features for this launch</label>
            <p className="form-hint" style={{ marginTop: '0.25rem' }}>
              LMS-controlled feature flags sent as <code>featureWhitelist</code> object in register-launch.
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(featureWhitelistEntry.enablePrintScreen)}
                onChange={() => toggleFeature('enablePrintScreen')}
              />
              <span>Print Screen / screenshots</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(featureWhitelistEntry.allowScreenSharing)}
                onChange={() => toggleFeature('allowScreenSharing')}
              />
              <span>Screen sharing</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(featureWhitelistEntry.allowMultipleDisplays)}
                onChange={() => toggleFeature('allowMultipleDisplays')}
              />
              <span>Multiple displays (max 2)</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(featureWhitelistEntry.allowExternalWebcam)}
                onChange={() => toggleFeature('allowExternalWebcam')}
              />
              <span>External webcam</span>
            </label>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lms-app-whitelist">
              Allowed applications
            </label>
            <p className="form-hint" style={{ marginTop: '0.25rem' }}>
              Windows executable names allowed during this launch (e.g. Slack.exe).
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id="lms-app-whitelist"
                className="input"
                type="text"
                value={newApp}
                onChange={(e) => setNewApp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addApplication();
                  }
                }}
                placeholder="e.g. Slack.exe"
              />
              <button type="button" className="btn btn-secondary" onClick={addApplication}>
                Add
              </button>
            </div>
            {applicationWhitelist.length > 0 ? (
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
                {applicationWhitelist.map((app, index) => (
                  <li key={`${app}-${index}`} style={{ marginBottom: '0.25rem' }}>
                    <code>{app}</code>{' '}
                    <button type="button" className="link-download" onClick={() => removeApplication(index)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="form-group">
            <label className="form-label">Input devices</label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={allowExternalInputDevices}
                onChange={(e) => setAllowExternalInputDevices(e.target.checked)}
              />
              <span>Allow external keyboard and mouse</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={requireWindowsLocationEnabled}
                onChange={(e) => setRequireWindowsLocationEnabled(e.target.checked)}
              />
              <span>Require Windows location access before exam start</span>
            </label>
          </div>
          <div className="form-group">
            <label className="form-label">Interview browsing settings</label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={allowNewBrowserTab}
                onChange={(e) => setAllowNewBrowserTab(e.target.checked)}
              />
              <span>Allow new browser window / tab behavior</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={restrictNavigationToAllowlist}
                onChange={(e) => setRestrictNavigationToAllowlist(e.target.checked)}
              />
              <span>Restrict navigation to allowlist (interview only)</span>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                className="input"
                type="text"
                value={newWebsite}
                onChange={(e) => setNewWebsite(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addWebsite();
                  }
                }}
                placeholder="https://meet.google.com/..."
                disabled={!interviewAllowlistEditingEnabled}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={addWebsite}
                disabled={!interviewAllowlistEditingEnabled}
              >
                Add
              </button>
            </div>
            {websiteAllowlist.length > 0 ? (
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
                {websiteAllowlist.map((site, index) => (
                  <li key={`${site}-${index}`} style={{ marginBottom: '0.25rem' }}>
                    <code>{site}</code>{' '}
                    <button
                      type="button"
                      className="link-download"
                      onClick={() => removeWebsite(index)}
                      disabled={!interviewAllowlistEditingEnabled}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {securityTemplate === PLAN_TYPE.STRICT ? (
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
      </div>

      {token && <div className="session-pill">Signed in as session user</div>}
    </AppShell>
  );
}

function App() {
  return <LmsStartPage />;
}

export default App;
