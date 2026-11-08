/** Gmail API wrappers with pacing and a per-batch quota budget (Gmail allows 250 units/user/second). */

function requireGmailService_() {
  if (typeof Gmail === 'undefined') {
    throw new Error(
      'The Gmail advanced service is off. In the editor: Services (+) → Gmail API → Add, then run setup again.',
    );
  }
}

function pace_(ctx, units) {
  if (!ctx) return;
  if (ctx.gmailUnits + units > MAILOPS.GMAIL_UNIT_BUDGET) {
    throw pauseError_('Gmail API budget for this batch reached (' + ctx.gmailUnits + ' units).');
  }
  const gap = MAILOPS.GMAIL_CALL_GAP_MS - (Date.now() - (ctx.lastCallMs || 0));
  if (gap > 0) Utilities.sleep(gap);
  ctx.gmailUnits += units;
  ctx.lastCallMs = Date.now();
}

function gmailCall_(ctx, units, what, fn) {
  pace_(ctx, units);
  try {
    return fn();
  } catch (e) {
    if (isQuotaError_(e)) throw pauseError_('Gmail per-minute quota reached while ' + what + '.');
    throw e;
  }
}

function listMessages_(ctx, q, pageToken) {
  const args = { q: q, maxResults: 50 };
  if (pageToken) args.pageToken = pageToken;
  return gmailCall_(ctx, 5, 'listing messages', function () {
    return Gmail.Users.Messages.list('me', args);
  });
}

/** Metadata only: labels, date, From and Subject headers. Bodies are never fetched. */
function getMessageMeta_(ctx, id) {
  return gmailCall_(ctx, 5, 'reading a message', function () {
    return Gmail.Users.Messages.get('me', id, {
      format: 'metadata',
      metadataHeaders: ['From', 'Subject'],
    });
  });
}

function archiveMessage_(ctx, id) {
  return gmailCall_(ctx, 5, 'archiving', function () {
    return Gmail.Users.Messages.modify({ removeLabelIds: ['INBOX'] }, 'me', id);
  });
}

/** Moves to Gmail Trash (recoverable for 30 days). There is no permanent delete anywhere. */
function trashMessage_(ctx, id) {
  return gmailCall_(ctx, 5, 'moving to Trash', function () {
    return Gmail.Users.Messages.trash('me', id);
  });
}

function labelMaps_() {
  const res = Gmail.Users.Labels.list('me');
  const nameToId = {};
  const idToName = {};
  (res.labels || []).forEach(function (l) {
    nameToId[l.name] = l.id;
    idToName[l.id] = l.name;
  });
  return { nameToId: nameToId, idToName: idToName, labels: res.labels || [] };
}

/** Creates a (nested) label and any missing parents. Returns its id. Never renames or deletes. */
function ensureLabel_(name) {
  const maps = labelMaps_();
  if (maps.nameToId[name]) return { id: maps.nameToId[name], created: false };
  const parts = name.split('/');
  let id = null;
  for (let i = 1; i <= parts.length; i++) {
    const n = parts.slice(0, i).join('/');
    if (maps.nameToId[n]) {
      id = maps.nameToId[n];
      continue;
    }
    const l = Gmail.Users.Labels.create(
      { name: n, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
      'me',
    );
    maps.nameToId[n] = l.id;
    id = l.id;
  }
  return { id: id, created: true };
}

/** The protected label must exist, so "never touch messages labelled Keep" can be enforced. */
function ensureProtectedLabel_(settings) {
  const name = String(settings.protectedLabel || '').trim();
  if (name) ensureLabel_(name);
}

function gmailAddress_() {
  try {
    return String(Gmail.Users.getProfile('me').emailAddress || '').toLowerCase();
  } catch (e) {
    return String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  }
}

function pauseError_(message) {
  const e = new Error(message);
  e.mailOpsPause = true;
  return e;
}

function isPauseError_(e) {
  return !!(e && e.mailOpsPause);
}

function isQuotaError_(e) {
  return /Quota exceeded|Total Query Cost|User-rate limit exceeded|Too many requests|429/i.test(
    String((e && e.message) || e || ''),
  );
}

function qesc_(s) {
  return String(s).replace(/"/g, '\\"');
}
