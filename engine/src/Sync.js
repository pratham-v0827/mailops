/**
 * The 15-minute sync: check in, refresh the config, carry out queued commands, keep the label and
 * filter mirrors fresh, keep the schedule in line with the settings, and raise alerts.
 * Kept short (a few seconds) so it fits Apps Script's daily trigger budget.
 */
function mailopsSync() {
  if (!isConnected_()) return 'not connected';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return 'skipped: a run is active';
  let cfg;
  try {
    try {
      cfg = loadConfig_(true);
    } catch (e) {
      console.warn('MailOps sync: ' + e.message);
      return 'no config';
    }
    const hb = sendHeartbeat_(cfg);
    if (!hb.ok && (hb.code === 401 || hb.code === 403)) {
      alert_(
        'auth',
        'MailOps engine disconnected',
        'The dashboard rejected this engine (' +
          hb.error +
          '). Open the Apps Script project and run setup.',
      );
      return 'rejected';
    }
    if (cfg.pendingCommands > 0) processCommands_(cfg);
    ensureTriggers_(cfg.settings);
    refreshMirrors_();
    checkOverdue_(cfg);
    return 'ok';
  } finally {
    lock.releaseLock();
  }
}

function processCommands_(cfg) {
  const res = apiRequest_('get', '/api/engine/commands', null);
  if (!res.ok) return;
  (res.data.commands || []).forEach(function (c) {
    let result;
    try {
      result = { ok: true, message: applyCommand_(c.payload, cfg) || 'Done.' };
    } catch (e) {
      result = { ok: false, message: String(e && e.message ? e.message : e).slice(0, 1000) };
    }
    apiRequest_('post', '/api/engine/commands/' + encodeURIComponent(c.id), result);
  });
}

function applyCommand_(p, cfg) {
  switch (p && p.kind) {
    case 'label.create': {
      const r = ensureLabel_(p.label);
      setState_({ mirrorDueAt: 0 });
      return r.created ? 'Created label ' + p.label + '.' : 'Label already existed.';
    }
    case 'filter.create':
      return createFilter_(p);
    case 'run.start': {
      if (p.mode === 'prod' && !isProduction_(cfg.settings)) {
        throw new Error('Production is off for this mailbox (automation off or dry run on).');
      }
      const s = startSession_(p.mode === 'prod' ? 'prod' : 'dry', 'DASHBOARD');
      // Start the first batch in a separate execution so this sync stays short.
      ScriptApp.newTrigger(MAILOPS.HANDLER.CONTINUE)
        .timeBased()
        .after(60 * 1000)
        .create();
      return 'Started ' + s.mode + ' pass ' + s.id + '; first batch within a few minutes.';
    }
    case 'run.stop': {
      const s = getSession_();
      endSession_('stopped from the dashboard');
      return s ? 'Stopped ' + s.mode + ' pass ' + s.id + '.' : 'No pass was running.';
    }
    case 'mirror.refresh':
      setState_({ mirrorDueAt: 0, filterHealthCursor: 0 });
      return 'Labels and filters will be re-sent within this sync.';
    default:
      throw new Error('Unknown command: ' + (p && p.kind));
  }
}

/** Creates a Gmail filter that adds a label (and optionally skips the inbox). Never deletes filters. */
function createFilter_(p) {
  const label = ensureLabel_(p.addLabel);
  const criteria = {};
  ['from', 'to', 'subject', 'query', 'negatedQuery', 'hasAttachment'].forEach(function (k) {
    if (p.criteria[k] !== undefined) criteria[k] = p.criteria[k];
  });
  const action = { addLabelIds: [label.id] };
  if (p.archive) action.removeLabelIds = ['INBOX'];
  const existing = (Gmail.Users.Settings.Filters.list('me').filter || []).some(function (f) {
    return (
      JSON.stringify(sortKeys_(f.criteria || {})) === JSON.stringify(sortKeys_(criteria)) &&
      (f.action && f.action.addLabelIds ? f.action.addLabelIds : []).indexOf(label.id) >= 0
    );
  });
  if (existing) return 'An identical filter already exists.';
  Gmail.Users.Settings.Filters.create({ criteria: criteria, action: action }, 'me');
  setState_({ mirrorDueAt: 0 });
  return 'Created filter → ' + p.addLabel + (p.archive ? ' (skips the inbox)' : '') + '.';
}

function sortKeys_(o) {
  const out = {};
  Object.keys(o)
    .sort()
    .forEach(function (k) {
      out[k] = o[k];
    });
  return out;
}

/**
 * Sends the label list (daily, or after a change) and the filter list with filter health: how many
 * messages in the last 30 days match each filter, and how many of those carry its label. Health is
 * checked a few filters per sync so each sync stays short.
 */
function refreshMirrors_() {
  const st = getState_();
  const now = Date.now();
  if (!st.mirrorDueAt || now >= st.mirrorDueAt) {
    const maps = labelMaps_();
    const labels = maps.labels.map(function (l) {
      return { id: l.id, name: l.name, type: l.type === 'system' ? 'system' : 'user' };
    });
    // Message counts for user labels (one call each, so capped).
    labels
      .filter(function (l) {
        return l.type === 'user';
      })
      .slice(0, 400)
      .forEach(function (l) {
        try {
          const full = Gmail.Users.Labels.get('me', l.id);
          l.messagesTotal = Number(full.messagesTotal || 0);
          l.messagesUnread = Number(full.messagesUnread || 0);
        } catch (e) {
          // counts are optional
        }
      });
    apiRequest_('post', '/api/engine/labels', { labels: labels });

    const filters = (Gmail.Users.Settings.Filters.list('me').filter || []).map(function (f) {
      return mirrorFilter_(f, maps.idToName);
    });
    apiRequest_('post', '/api/engine/filters', { filters: filters, complete: true });
    setState_({ mirrorDueAt: now + 24 * 3600 * 1000, filterHealthCursor: 0 });
    return;
  }

  // Filter health, 6 filters per sync (~2 days for 500 filters).
  const all = Gmail.Users.Settings.Filters.list('me').filter || [];
  let cursor = Number(st.filterHealthCursor || 0);
  if (cursor >= all.length) return;
  const maps = labelMaps_();
  const batch = all.slice(cursor, cursor + 6).map(function (f) {
    const m = mirrorFilter_(f, maps.idToName);
    const q = filterQuery_(f.criteria || {});
    const label = m.addLabels[0];
    if (q && label) {
      const matched = countMessages_(q + ' newer_than:30d');
      const labelled = countMessages_(q + ' newer_than:30d label:"' + qesc_(label) + '"');
      m.health = {
        matched30d: matched,
        labelled30d: labelled,
        checkedAt: new Date().toISOString(),
      };
    }
    return m;
  });
  apiRequest_('post', '/api/engine/filters', { filters: batch, complete: false });
  setState_({ filterHealthCursor: cursor + batch.length });
}

function mirrorFilter_(f, idToName) {
  const a = f.action || {};
  const names = function (ids) {
    return (ids || []).map(function (id) {
      return idToName[id] || id;
    });
  };
  const m = {
    id: String(f.id),
    criteria: f.criteria || {},
    addLabels: names(a.addLabelIds),
    removeLabels: names(a.removeLabelIds),
  };
  if (a.forward) m.forward = String(a.forward);
  return m;
}

/** Gmail search equivalent of a filter's criteria. */
function filterQuery_(c) {
  const parts = [];
  if (c.from) parts.push('from:(' + c.from + ')');
  if (c.to) parts.push('to:(' + c.to + ')');
  if (c.subject) parts.push('subject:(' + c.subject + ')');
  if (c.query) parts.push('(' + c.query + ')');
  if (c.negatedQuery) parts.push('-(' + c.negatedQuery + ')');
  if (c.hasAttachment) parts.push('has:attachment');
  return parts.join(' ');
}

/** Counts matching messages (exact up to 500, then "500+" is reported as 500). */
function countMessages_(q) {
  let n = 0;
  let token = null;
  do {
    const res = Gmail.Users.Messages.list('me', { q: q, maxResults: 500, pageToken: token });
    n += (res.messages || []).length;
    token = res.nextPageToken;
  } while (token && n < 500);
  return n;
}

/** Emails the owner if production is on but no pass has started for over 30 hours. */
function checkOverdue_(cfg) {
  if (!cfg.settings.automationEnabled) return;
  const st = getState_();
  const last = Number(st.lastPassStartedAt || st.installedAt || 0);
  if (last && Date.now() - last > 30 * 3600 * 1000) {
    alert_(
      'overdue',
      'MailOps nightly pass is overdue',
      'No lifecycle pass has started since ' +
        new Date(last).toISOString() +
        '. Open the Apps Script project and run status to check its triggers.',
    );
  }
}

/** Sends at most one alert of each kind per 20 hours, from and to the account owner. */
function alert_(kind, subject, body) {
  try {
    const cached = readCachedConfig_();
    if (cached && cached.config.settings.emailAlerts === false) return;
    const st = getState_();
    const sent = st.alertsSent || {};
    if (sent[kind] && Date.now() - sent[kind] < 20 * 3600 * 1000) return;
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: '[MailOps] ' + subject,
      body: body + '\n\nDashboard: ' + dashboardUrl_() + '\n',
    });
    sent[kind] = Date.now();
    setState_({ alertsSent: sent });
  } catch (e) {
    console.warn('MailOps alert not sent: ' + e.message);
  }
}
