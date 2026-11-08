/**
 * MailOps dashboard connector for Google Apps Script (any engine, V8 runtime).
 *
 * Lets an Apps Script engine running in a Gmail account report to the MailOps dashboard:
 *   - mailopsConnectDashboard()     prompt for the connector token (sheet-bound scripts), verify, store
 *   - mailopsDisconnectDashboard()  forget the token
 *   - mailopsHeartbeat_(info)       check in; proves which Gmail account the engine runs in
 *   - mailopsReportRun_(run)        report one run (counts only, never email content)
 *   - mailopsFetchConfig_()         pull this mailbox's settings and rules
 *
 * Needs the OAuth scope https://www.googleapis.com/auth/script.external_request (UrlFetchApp) and
 * the Gmail advanced service (Gmail.Users.getProfile). The token is kept in Script Properties.
 * Every call is best-effort: failures are logged and returned, never thrown into the engine.
 */

const MAILOPS_CONNECTOR = {
  VERSION: 'connector-1.0.0',
  PROP_TOKEN: 'MAILOPS_DASHBOARD_TOKEN',
  PROP_URL: 'MAILOPS_DASHBOARD_URL',
  DEFAULT_URL: 'https://mailops-gamma.vercel.app',
  TOKEN_RE: /^mops_[A-Za-z0-9_-]{43}$/,
};

function mailopsConnectDashboard() {
  // With granular consent a user can hold an older grant without the web-request scope; this
  // ends the run and shows Google's authorization prompt for it instead of failing later.
  mailopsRequireFetchScope_();
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'Connect to MailOps dashboard',
    'Paste the connector token from the dashboard (Overview → Engine connection):',
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return 'Cancelled.';
  const token = String(res.getResponseText() || '').trim();
  if (!MAILOPS_CONNECTOR.TOKEN_RE.test(token)) {
    ui.alert('That does not look like a MailOps connector token (it starts with "mops_").');
    return 'Invalid token.';
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty(MAILOPS_CONNECTOR.PROP_TOKEN, token);
  if (!props.getProperty(MAILOPS_CONNECTOR.PROP_URL)) {
    props.setProperty(MAILOPS_CONNECTOR.PROP_URL, MAILOPS_CONNECTOR.DEFAULT_URL);
  }

  const hb = mailopsHeartbeat_({});
  if (!hb.ok) {
    ui.alert('Saved the token, but the dashboard rejected the check-in:\n\n' + hb.error);
    return hb.error;
  }
  const cfg = mailopsFetchConfig_();
  const msg =
    'Connected to MailOps dashboard as ' +
    mailopsGmailAddress_() +
    '.' +
    (cfg.ok ? '\nDashboard has ' + cfg.data.rules.length + ' rule(s) for this mailbox.' : '');
  ui.alert(msg);
  return msg;
}

function mailopsDisconnectDashboard() {
  PropertiesService.getScriptProperties().deleteProperty(MAILOPS_CONNECTOR.PROP_TOKEN);
  return 'Disconnected from MailOps dashboard (token removed from this script).';
}

function mailopsRequireFetchScope_() {
  if (typeof ScriptApp.requireScopes === 'function') {
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, [
      'https://www.googleapis.com/auth/script.external_request',
    ]);
  }
}

function mailopsIsConnected_() {
  return !!PropertiesService.getScriptProperties().getProperty(MAILOPS_CONNECTOR.PROP_TOKEN);
}

/** info: { engineVersion?, mode?: 'dry'|'prod', automationEnabled?: boolean } */
function mailopsHeartbeat_(info) {
  info = info || {};
  return mailopsRequest_('post', '/api/engine/heartbeat', {
    engineVersion: String(info.engineVersion || MAILOPS_CONNECTOR.VERSION),
    gmailAddress: mailopsGmailAddress_(),
    mode: info.mode,
    automationEnabled: info.automationEnabled,
  });
}

/** run: see EngineRunReport in @mailops/schema (ISO timestamps, integer counts). */
function mailopsReportRun_(run) {
  return mailopsRequest_('post', '/api/engine/runs', run);
}

function mailopsFetchConfig_() {
  return mailopsRequest_('get', '/api/engine/config', null);
}

function mailopsGmailAddress_() {
  return String(Gmail.Users.getProfile('me').emailAddress || '').toLowerCase();
}

/** Returns { ok: true, data } or { ok: false, error } — never throws. */
function mailopsRequest_(method, path, body) {
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty(MAILOPS_CONNECTOR.PROP_TOKEN);
    if (!token) return { ok: false, error: 'Not connected to the MailOps dashboard.' };
    const base = (
      props.getProperty(MAILOPS_CONNECTOR.PROP_URL) || MAILOPS_CONNECTOR.DEFAULT_URL
    ).replace(/\/+$/, '');

    const options = {
      method: method,
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
      followRedirects: false,
    };
    if (body) {
      options.contentType = 'application/json';
      options.payload = JSON.stringify(body);
    }
    const res = UrlFetchApp.fetch(base + path, options);
    const code = res.getResponseCode();
    let data = null;
    try {
      data = JSON.parse(res.getContentText());
    } catch (_) {
      data = null;
    }
    if (code >= 200 && code < 300) return { ok: true, data: data };
    const error =
      'HTTP ' + code + ': ' + ((data && data.error) || res.getContentText().slice(0, 200));
    console.warn('MailOps dashboard ' + path + ' failed: ' + error);
    return { ok: false, error: error };
  } catch (e) {
    console.warn('MailOps dashboard ' + path + ' error: ' + (e && e.message ? e.message : e));
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
