/**
 * Lifecycle passes: archive and move to Trash by rule, in resumable batches that fit Apps Script's
 * 6-minute limit. The decision logic is the same as MailOps v2.6 (multi-label effective policy,
 * global guard, Never Delete, Protect Unread/Starred).
 */

/** Nightly trigger: starts (or continues) a pass in the mode the settings allow. */
function mailopsNightly() {
  let cfg;
  try {
    cfg = loadConfig_(true);
  } catch (e) {
    alert_(
      'config',
      'Nightly pass skipped',
      'MailOps could not load its configuration: ' + e.message,
    );
    return 'skipped: no config';
  }
  if (!cfg.settings.automationEnabled) {
    reportSkipped_(cfg, 'NIGHTLY', 'Automation is off for this mailbox.');
    return 'skipped: automation off';
  }
  const mode = isProduction_(cfg.settings) ? 'prod' : 'dry';
  const s = getSession_();
  if (!s || s.mode !== mode) startSession_(mode, 'NIGHTLY');
  return runBatch_(cfg);
}

/** Continuation trigger: runs the next batch of the pass in progress. */
function mailopsContinue() {
  removeTriggers_(MAILOPS.HANDLER.CONTINUE);
  if (!getSession_()) return 'no pass in progress';
  return runBatch_(loadConfig_(true));
}

function runBatch_(cfg) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    // Another execution (usually the 15-minute sync) holds the lock: try again shortly so the
    // pass doesn't stall.
    if (getSession_()) {
      removeTriggers_(MAILOPS.HANDLER.CONTINUE);
      ScriptApp.newTrigger(MAILOPS.HANDLER.CONTINUE)
        .timeBased()
        .after(MAILOPS.CONTINUE_DELAY_MIN * 60 * 1000)
        .create();
    }
    return 'skipped: another run is active; retrying shortly';
  }
  const session = getSession_();
  if (!session) {
    lock.releaseLock();
    return 'no pass in progress';
  }
  const settings = cfg.settings;
  const ctx = {
    runId: stamp_() + '-' + Utilities.getUuid().slice(0, 8),
    startedAt: new Date(),
    startedMs: Date.now(),
    settings: settings,
    maxMessages: settings.maxMessagesPerBatch,
    maxRuntimeMs: settings.maxRuntimeSeconds * 1000,
    gmailUnits: 0,
    lastCallMs: 0,
    paused: false,
    scanned: 0,
    archived: 0,
    trashed: 0,
    protected: 0,
    skipped: 0,
    errors: 0,
    notes: [],
    events: [],
    processed: {},
    trashLimitNoted: false,
  };

  try {
    if (session.mode === 'prod') {
      if (!isProduction_(settings)) {
        endSession_('production was turned off');
        ctx.notes.push('Production pass stopped: production is off in Settings.');
        return finishBatch_(cfg, session, ctx, 'SKIPPED', true);
      }
      if (cfg.fromCache && cfg.cacheAgeMs > MAILOPS.CONFIG_MAX_AGE_MS) {
        endSession_('config too old');
        throw new Error(
          'The dashboard has been unreachable for days; production paused until it is back.',
        );
      }
    }
    if (cfg.fromCache) ctx.notes.push('Dashboard unreachable: used the cached configuration.');

    const maps = labelMaps_();
    ctx.gmailUnits += 1;
    ctx.guard = guard_(settings, maps);
    ctx.rules = [];
    ctx.rulesById = {};
    cfg.rules.forEach(function (r) {
      if (!r.enabled) return;
      const id = maps.nameToId[r.label];
      if (!id) {
        ctx.notes.push('Skipped rule (label missing in Gmail): ' + r.label);
        return;
      }
      ctx.rules.push(r);
      ctx.rulesById[id] = r;
    });
    if (cfg.droppedRules && cfg.droppedRules.length) {
      ctx.notes.push('Ignored invalid rules: ' + cfg.droppedRules.join(', '));
    }

    let idx = startIndex_(ctx.rules, session.label);
    while (idx < ctx.rules.length && !shouldStop_(ctx)) {
      const r = ctx.rules[idx];
      if (session.label !== r.label) moveCursor_(session, r.label);
      let done = true;
      try {
        done = processRule_(ctx, session, r);
      } catch (e) {
        if (isPauseError_(e) || isQuotaError_(e)) {
          ctx.paused = true;
          ctx.notes.push('Paused safely: ' + e.message);
          break;
        }
        ctx.errors++;
        ctx.notes.push('Rule ' + r.label + ' failed: ' + e.message);
      }
      if (!done) break;
      idx++;
      moveCursor_(session, idx < ctx.rules.length ? ctx.rules[idx].label : null);
    }

    const complete = idx >= ctx.rules.length && !ctx.paused;
    if (!complete && !ctx.paused) ctx.notes.push('Batch limit reached; continuing shortly.');
    const status = complete
      ? ctx.errors
        ? 'PARTIAL SUCCESS'
        : 'SUCCESS'
      : ctx.paused
        ? 'PAUSED'
        : ctx.errors
          ? 'PARTIAL SUCCESS'
          : 'CONTINUING';
    return finishBatch_(cfg, session, ctx, status, complete);
  } catch (e) {
    ctx.errors++;
    ctx.notes.unshift('Failed: ' + e.message);
    endSession_('failed');
    finishBatch_(cfg, session, ctx, 'FAILED', true);
    alert_('failed', 'A MailOps run failed', 'Run ' + ctx.runId + ' failed:\n\n' + e.message);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function finishBatch_(cfg, session, ctx, status, complete) {
  const failedEvents = ctx.events.length ? sendEvents_(ctx.events) : 0;
  if (failedEvents) ctx.notes.push(failedEvents + ' audit event(s) could not be sent.');

  session.batches = (session.batches || 0) + 1;
  if (complete) {
    if (getSession_()) endSession_('pass complete');
    if (status !== 'FAILED' && status !== 'SKIPPED') {
      setState_({ lastPassCompletedAt: Date.now(), lastPassMode: session.mode });
    }
  } else if (session.batches >= 300) {
    endSession_('too many batches');
    ctx.notes.push('Stopped after 300 batches; the next nightly pass starts fresh.');
  } else {
    scheduleContinue_(session, ctx.paused);
    saveSession_(session);
  }

  const ended = new Date();
  reportRun_({
    runId: ctx.runId,
    sessionId: session.id,
    startedAt: ctx.startedAt.toISOString(),
    endedAt: ended.toISOString(),
    mode: session.mode,
    status: status,
    scanned: ctx.scanned,
    archived: ctx.archived,
    trashed: ctx.trashed,
    protected: ctx.protected,
    skipped: ctx.skipped,
    errors: ctx.errors,
    triggerType: String(session.trigger || '').slice(0, 50) + ' #' + session.batches,
    engineVersion: MAILOPS.VERSION,
    notes: ctx.notes.join(' | ').slice(0, 1000),
  });

  const summary =
    status +
    ' (' +
    session.mode +
    '): scanned ' +
    ctx.scanned +
    ', archived ' +
    ctx.archived +
    ', trashed ' +
    ctx.trashed +
    ', protected ' +
    ctx.protected +
    ', skipped ' +
    ctx.skipped +
    ', errors ' +
    ctx.errors +
    (ctx.notes.length ? '\n' + ctx.notes.join('\n') : '');
  console.log(summary);
  return summary;
}

function reportSkipped_(cfg, trigger, note) {
  const now = new Date().toISOString();
  reportRun_({
    runId: stamp_() + '-' + Utilities.getUuid().slice(0, 8),
    sessionId: '',
    startedAt: now,
    endedAt: now,
    mode: isProduction_(cfg.settings) ? 'prod' : 'dry',
    status: 'SKIPPED',
    scanned: 0,
    archived: 0,
    trashed: 0,
    protected: 0,
    skipped: 0,
    errors: 0,
    triggerType: trigger,
    engineVersion: MAILOPS.VERSION,
    notes: note,
  });
}

function shouldStop_(ctx) {
  return (
    ctx.paused || ctx.scanned >= ctx.maxMessages || Date.now() - ctx.startedMs >= ctx.maxRuntimeMs
  );
}

/** Index of the rule to resume at: the saved label, or the next one after it alphabetically. */
function startIndex_(rules, label) {
  if (label === null || label === undefined) return 0;
  for (let i = 0; i < rules.length; i++) if (rules[i].label >= label) return i;
  return rules.length;
}

function moveCursor_(session, label) {
  session.label = label;
  session.phase = 'archive';
  session.pageToken = null;
  session.offset = 0;
}

/** Runs one rule's archive phase, then its trash phase. Returns false if stopped by a limit. */
function processRule_(ctx, session, r) {
  const base = 'label:"' + qesc_(r.label) + '"';
  if (session.phase === 'archive') {
    if (r.archiveAfterDays !== null) {
      const q =
        base +
        ' in:inbox older_than:' +
        Math.max(1, r.archiveAfterDays) +
        'd -in:trash -in:spam' +
        ctx.guard.query;
      if (!scan_(ctx, session, r, q)) return false;
    }
    session.phase = 'trash';
    session.pageToken = null;
    session.offset = 0;
  }
  if (!r.neverDelete && r.trashAfterDays !== null) {
    let q =
      base +
      ' older_than:' +
      Math.max(1, r.trashAfterDays) +
      'd -in:trash -in:spam' +
      ctx.guard.query;
    if (r.protectStarred) q += ' -is:starred';
    if (!scan_(ctx, session, r, q)) return false;
  }
  return true;
}

/** Pages through one search. The cursor (page token + offset) is kept in the session. */
function scan_(ctx, session, rule, q) {
  let retriedToken = false;
  for (;;) {
    if (shouldStop_(ctx)) return false;
    let res;
    try {
      res = listMessages_(ctx, q, session.pageToken);
    } catch (e) {
      if (session.pageToken && !retriedToken && !isPauseError_(e)) {
        // An old page token can expire between batches; restart this search once.
        retriedToken = true;
        session.pageToken = null;
        session.offset = 0;
        continue;
      }
      throw e;
    }
    const msgs = res.messages || [];
    for (let i = session.offset || 0; i < msgs.length; i++) {
      if (shouldStop_(ctx)) {
        session.offset = i;
        return false;
      }
      const id = msgs[i].id;
      if (ctx.processed[id]) continue;
      ctx.processed[id] = 1;
      ctx.scanned++;
      try {
        processMessage_(ctx, session, id, rule);
      } catch (e) {
        if (isPauseError_(e) || isQuotaError_(e)) {
          session.offset = i;
          delete ctx.processed[id];
          ctx.scanned--;
          throw e;
        }
        ctx.errors++;
        ctx.notes.push('Message ' + id + ': ' + e.message);
      }
      session.offset = i + 1;
    }
    if (!res.nextPageToken) {
      session.pageToken = null;
      session.offset = 0;
      return true;
    }
    session.pageToken = res.nextPageToken;
    session.offset = 0;
  }
}

function processMessage_(ctx, session, id, rule) {
  const msg = getMessageMeta_(ctx, id);
  const ids = msg.labelIds || [];
  if (ids.indexOf('TRASH') >= 0 || ids.indexOf('SPAM') >= 0) {
    ctx.skipped++;
    return;
  }
  const age = Math.floor((Date.now() - Number(msg.internalDate)) / 86400000);
  const matched = ids
    .map(function (x) {
      return ctx.rulesById[x] || null;
    })
    .filter(Boolean);
  if (
    !matched.some(function (m) {
      return m.label === rule.label;
    })
  )
    matched.push(rule);

  const p = effectivePolicy_(matched);
  const dry = session.mode === 'dry';
  const rulePreview = matched.some(function (m) {
    return inPreview_(m, ctx.settings);
  });
  const ev = function (action, preview, reason) {
    ctx.events.push(eventFor_(ctx, session, msg, rule, action, preview, reason, age));
  };

  const guardReason = ctx.guard.reason(ids);
  if (guardReason) {
    ctx.protected++;
    ev('protect', dry, guardReason);
    return;
  }

  const inbox = ids.indexOf('INBOX') >= 0;
  const unread = ids.indexOf('UNREAD') >= 0;
  const starred = ids.indexOf('STARRED') >= 0;
  const archiveDue =
    inbox && p.archive !== null && age >= p.archive && !(p.protectUnread && unread);
  const trashDue = p.trash !== null && age >= p.trash;

  let block = '';
  if (p.neverDelete) block = 'Never Delete rule.';
  else if (p.protectStarred && starred) block = 'Starred message protected from Trash.';
  else if (p.protectUnread && unread) block = 'Unread protection enabled.';

  if (trashDue) {
    if (block) {
      ctx.protected++;
      ev('protect', dry, block);
      return;
    }
    if (dry) {
      ctx.trashed++;
      ev('trash', true, 'Dry run: would move to Trash.');
      return;
    }
    if (rulePreview) {
      ctx.skipped++;
      ev('trash', true, 'Rule changed recently: previewing before acting.');
      return;
    }
    if (session.trashed >= ctx.settings.maxTrashPerPass) {
      ctx.skipped++;
      if (!ctx.trashLimitNoted) {
        ctx.trashLimitNoted = true;
        ctx.notes.push('Trash limit for this pass (' + ctx.settings.maxTrashPerPass + ') reached.');
      }
      ev('trash', true, 'Trash limit for this pass reached.');
      return;
    }
    trashMessage_(ctx, id);
    session.trashed = (session.trashed || 0) + 1;
    ctx.trashed++;
    ev('trash', false, 'Moved to Gmail Trash.');
    return;
  }

  if (archiveDue) {
    if (dry) {
      ctx.archived++;
      ev('archive', true, 'Dry run: would archive.');
      return;
    }
    if (rulePreview) {
      ctx.skipped++;
      ev('archive', true, 'Rule changed recently: previewing before acting.');
      return;
    }
    archiveMessage_(ctx, id);
    ctx.archived++;
    ev('archive', false, 'Archived by lifecycle rule.');
    return;
  }
  ctx.skipped++;
}

function eventFor_(ctx, session, msg, rule, action, preview, reason, age) {
  const h = {};
  ((msg.payload || {}).headers || []).forEach(function (x) {
    h[String(x.name || '').toLowerCase()] = String(x.value || '');
  });
  const e = {
    messageId: msg.id,
    threadId: msg.threadId || msg.id,
    at: new Date().toISOString(),
    runId: ctx.runId,
    mode: session.mode,
    action: action,
    preview: !!preview,
    label: rule.label,
    reason: String(reason).slice(0, 200),
    ageDays: Math.max(0, Math.min(36500, age)),
    senderDomain: senderDomain_(h.from || ''),
  };
  if (ctx.settings.storeSubjects && h.subject) e.subject = h.subject.slice(0, 200);
  return e;
}

function senderDomain_(from) {
  const m = String(from).match(/<([^>]+)>/);
  const addr = (m ? m[1] : String(from)).trim();
  const at = addr.lastIndexOf('@');
  return at >= 0
    ? addr
        .slice(at + 1)
        .replace(/[>\s]/g, '')
        .toLowerCase()
        .slice(0, 253)
    : '';
}

function inPreview_(rule, settings) {
  const hours = settings.newRulePreviewHours;
  if (!hours || !rule.changedAt) return false;
  const t = Date.parse(rule.changedAt);
  return !isNaN(t) && Date.now() - t < hours * 3600 * 1000;
}

/**
 * The global guard: starred, Important and the protected label are never archived or trashed.
 * Returns a search suffix for candidate queries and a per-message check (a message can be reached
 * through another label's rule).
 */
function guard_(settings, maps) {
  const starred = settings.neverTouchStarred !== false;
  const important = settings.neverTouchImportant !== false;
  const protName = String(settings.protectedLabel || '').trim();
  const protId = protName ? maps.nameToId[protName] : null;
  if (protName && !protId) {
    throw new Error('Protected label "' + protName + '" does not exist in Gmail. Run setup again.');
  }
  let query = '';
  if (starred) query += ' -is:starred';
  if (important) query += ' -is:important';
  if (protId) query += ' -label:"' + qesc_(protName) + '"';
  return {
    query: query,
    reason: function (ids) {
      if (starred && ids.indexOf('STARRED') >= 0) return 'Starred: global guard.';
      if (important && ids.indexOf('IMPORTANT') >= 0) return 'Important: global guard.';
      if (protId && ids.indexOf(protId) >= 0) return 'Protected label "' + protName + '".';
      return '';
    },
  };
}

/**
 * Combines every rule matching a message's labels. The most cautious rule wins: the longest ages,
 * and "never" (no age, or Never Delete) beats any age.
 */
function effectivePolicy_(rs) {
  const archive = [];
  const trash = [];
  let archiveNever = false;
  let trashNever = false;
  let never = false;
  let pu = false;
  let ps = false;
  rs.forEach(function (r) {
    if (r.archiveAfterDays === null) archiveNever = true;
    else archive.push(r.archiveAfterDays);
    if (r.neverDelete) never = true;
    if (r.trashAfterDays === null) trashNever = true;
    else trash.push(r.trashAfterDays);
    pu = pu || r.protectUnread;
    ps = ps || r.protectStarred;
  });
  return {
    archive: archiveNever ? null : archive.length ? Math.max.apply(null, archive) : null,
    trash: never || trashNever ? null : trash.length ? Math.max.apply(null, trash) : null,
    neverDelete: never,
    protectUnread: pu,
    protectStarred: ps,
  };
}

function scheduleContinue_(session, paused) {
  let delay = MAILOPS.CONTINUE_DELAY_MIN;
  if (paused) {
    delay = Math.min(MAILOPS.BACKOFF_MAX_MIN, Math.max(delay, session.backoffMin || delay));
    session.backoffMin = Math.min(MAILOPS.BACKOFF_MAX_MIN, delay * 2);
  } else {
    session.backoffMin = MAILOPS.CONTINUE_DELAY_MIN;
  }
  removeTriggers_(MAILOPS.HANDLER.CONTINUE);
  ScriptApp.newTrigger(MAILOPS.HANDLER.CONTINUE)
    .timeBased()
    .after(delay * 60 * 1000)
    .create();
}

function stamp_() {
  return Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd-HHmmss');
}
