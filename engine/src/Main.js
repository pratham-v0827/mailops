/**
 * MailOps engine: entry points you can run from the Apps Script editor.
 *
 * Install: make a copy of the template project, open it, choose `setup` in the toolbar and click
 * Run. Approve Google's permission prompt, then open the link shown in the execution log and
 * approve the code on the MailOps dashboard. That's all: rules and settings live on the dashboard.
 *
 * Safety (enforced here, in your own Google account, whatever the dashboard sends):
 *   - dry run by default; production only when automation is on and dry run is off
 *   - "Trash" means Gmail Trash (recoverable for 30 days); nothing is ever permanently deleted
 *   - Starred, Important and the protected label (default "Keep") are never touched
 *   - a changed rule is previewed before it acts, and each pass trashes at most a set number
 *   - email bodies never leave your account
 */

/** Connects this engine to the dashboard (pairing) and installs its schedule. */
function setup() {
  requireGmailService_();
  const url = dashboardUrl_();

  if (isConnected_()) {
    const hb = sendHeartbeat_(null);
    if (hb.ok) {
      const cfg = loadConfig_(true);
      ensureProtectedLabel_(cfg.settings);
      ensureTriggers_(cfg.settings);
      mailopsSync();
      log_('Already connected to ' + url + ' as ' + gmailAddress_() + '. Schedule checked.');
      return 'Already connected.';
    }
    if (hb.code !== 401 && hb.code !== 403) {
      throw new Error(
        'The dashboard is not reachable right now (' + hb.error + '). Try again later.',
      );
    }
    log_('The saved connection is no longer valid (' + hb.error + '); pairing again.');
    clearConnection_();
  }

  const start = apiRequest_(
    'post',
    '/api/engine/pair/start',
    {
      identityToken: ScriptApp.getIdentityToken(),
      engineVersion: MAILOPS.VERSION,
    },
    { auth: false },
  );
  if (!start.ok) throw new Error('Could not start pairing: ' + start.error);

  const p = start.data;
  const link = url + '/pair?code=' + encodeURIComponent(p.userCode);
  log_(
    '\n\n  ▶ Open this link and approve the code ' +
      p.userCode +
      ':\n\n    ' +
      link +
      '\n\n  Signed-in Gmail account: ' +
      p.email +
      '\n  Waiting for approval (up to 5 minutes)…\n',
  );

  const deadline = Date.now() + Math.min(5 * 60 * 1000, p.expiresInSeconds * 1000);
  while (Date.now() < deadline) {
    Utilities.sleep(Math.max(3, p.intervalSeconds) * 1000);
    const poll = apiRequest_(
      'post',
      '/api/engine/pair/poll',
      { deviceCode: p.deviceCode },
      {
        auth: false,
      },
    );
    if (!poll.ok) {
      if (poll.code === 410 || poll.code === 404) throw new Error(poll.error);
      continue; // transient network error: keep waiting
    }
    if (poll.data.status !== 'approved') continue;

    const props = PropertiesService.getScriptProperties();
    props.setProperty(MAILOPS.PROP.TOKEN, poll.data.token);
    props.setProperty(MAILOPS.PROP.URL, url);

    const cfg = loadConfig_(true);
    ensureProtectedLabel_(cfg.settings);
    ensureTriggers_(cfg.settings);
    setState_({ mirrorDueAt: 0 });
    mailopsSync();

    const msg =
      'Connected as ' +
      poll.data.email +
      '. ' +
      cfg.rules.length +
      ' rule(s) on the dashboard. ' +
      'Mode: ' +
      (cfg.settings.dryRun || !cfg.settings.automationEnabled ? 'dry run' : 'production') +
      '. Nightly pass at ' +
      cfg.settings.dailyHour +
      ':00 (' +
      cfg.settings.timezone +
      ').';
    log_('✅ ' + msg + '\nYou can close this editor; everything else happens on the dashboard.');
    return msg;
  }
  throw new Error('No approval within 5 minutes. Run setup again to get a new code.');
}

/** Prints what this engine is doing: connection, mode, schedule and any pass in progress. */
function status() {
  const props = PropertiesService.getScriptProperties();
  const cached = readCachedConfig_();
  const session = getSession_();
  const lines = [
    'MailOps engine ' + MAILOPS.VERSION,
    'Dashboard: ' +
      dashboardUrl_() +
      (isConnected_() ? ' (connected)' : ' (not connected: run setup)'),
    'Gmail account: ' + gmailAddress_(),
    'Config: ' +
      (cached
        ? cached.config.rules.length + ' rules, fetched ' + new Date(cached.fetchedAt).toISOString()
        : 'none yet'),
    'Mode: ' +
      (cached
        ? cached.config.settings.dryRun || !cached.config.settings.automationEnabled
          ? 'dry run'
          : 'production'
        : 'unknown'),
    'Pass in progress: ' +
      (session ? session.mode + ' ' + session.id + ' at rule ' + session.label : 'none'),
    'Triggers: ' +
      ScriptApp.getProjectTriggers()
        .map(function (t) {
          return t.getHandlerFunction();
        })
        .join(', '),
    'Script properties: ' + props.getKeys().length,
  ];
  log_(lines.join('\n'));
  return lines.join('\n');
}

/** Starts a full dry run now (preview only; nothing in Gmail changes). */
function runDryRunNow() {
  const cfg = loadConfig_(true);
  startSession_('dry', 'MANUAL DRY RUN');
  return runBatch_(cfg);
}

/** Stops any pass in progress. The nightly schedule stays. */
function stopRun() {
  const s = getSession_();
  endSession_('stopped from the editor');
  log_(s ? 'Stopped ' + s.mode + ' pass ' + s.id + '.' : 'No pass was running.');
}

/** Disconnects from the dashboard and removes this engine's triggers. Gmail is not touched. */
function disconnect() {
  removeTriggers_(null);
  clearConnection_();
  log_('Disconnected. Triggers removed. Run setup to connect again.');
}
