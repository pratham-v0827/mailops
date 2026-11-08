/**
 * Talks to the MailOps dashboard API. Every call returns {ok, data} or {ok:false, code, error} and
 * never throws, so a dashboard problem can't break a run.
 */
function apiRequest_(method, path, body, opts) {
  opts = opts || {};
  try {
    const headers = {};
    if (opts.auth !== false) {
      const token = PropertiesService.getScriptProperties().getProperty(MAILOPS.PROP.TOKEN);
      if (!token) return { ok: false, code: 0, error: 'Not connected: run setup.' };
      headers.Authorization = 'Bearer ' + token;
    }
    const options = {
      method: method,
      headers: headers,
      muteHttpExceptions: true,
      followRedirects: false,
    };
    if (body) {
      options.contentType = 'application/json';
      options.payload = JSON.stringify(body);
    }
    const res = UrlFetchApp.fetch(dashboardUrl_() + path, options);
    const code = res.getResponseCode();
    let data = null;
    try {
      data = JSON.parse(res.getContentText());
    } catch (e) {
      data = null;
    }
    if (code >= 200 && code < 300) return { ok: true, code: code, data: data };
    const error =
      'HTTP ' + code + ': ' + ((data && data.error) || res.getContentText().slice(0, 200));
    console.warn('MailOps API ' + path + ' failed: ' + error);
    return { ok: false, code: code, error: error, data: data };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    console.warn('MailOps API ' + path + ' error: ' + msg);
    return { ok: false, code: 0, error: msg };
  }
}

function sendHeartbeat_(cfg) {
  const session = getSession_();
  const st = getState_();
  const state = {
    sessionActive: !!session,
    usingCachedConfig: !!(cfg && cfg.fromCache),
    nightlyTriggerHour: st.nightlyKey ? Number(String(st.nightlyKey).split('|')[0]) : null,
  };
  if (session) {
    state.sessionMode = session.mode;
    state.sessionId = session.id;
  }
  if (st.lastPassCompletedAt)
    state.lastPassCompletedAt = new Date(st.lastPassCompletedAt).toISOString();
  const body = {
    engineVersion: MAILOPS.VERSION,
    gmailAddress: gmailAddress_(),
    state: state,
  };
  if (cfg) {
    body.mode = isProduction_(cfg.settings) ? 'prod' : 'dry';
    body.automationEnabled = cfg.settings.automationEnabled;
  }
  return apiRequest_('post', '/api/engine/heartbeat', body);
}

function reportRun_(run) {
  return apiRequest_('post', '/api/engine/runs', run);
}

/** Sends audit events in batches of up to 500; keeps going if one batch fails. */
function sendEvents_(events) {
  let failed = 0;
  for (let i = 0; i < events.length; i += 500) {
    const res = apiRequest_('post', '/api/engine/events', { events: events.slice(i, i + 500) });
    if (!res.ok) failed += Math.min(500, events.length - i);
  }
  return failed;
}
