/** Small persistent state in Script Properties (values are limited to ~9 KB, so large ones are chunked). */

function getState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(MAILOPS.PROP.STATE);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function setState_(patch) {
  const s = getState_();
  Object.keys(patch).forEach(function (k) {
    s[k] = patch[k];
  });
  PropertiesService.getScriptProperties().setProperty(MAILOPS.PROP.STATE, JSON.stringify(s));
  return s;
}

/**
 * A lifecycle pass ("session") runs in batches. Its cursor is the rule label, the phase
 * (archive, then trash), and the Gmail page token + offset, so a dry run resumes exactly where it
 * stopped and every message is looked at once per pass.
 */
function getSession_() {
  const raw = PropertiesService.getScriptProperties().getProperty(MAILOPS.PROP.SESSION);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveSession_(s) {
  PropertiesService.getScriptProperties().setProperty(MAILOPS.PROP.SESSION, JSON.stringify(s));
}

function startSession_(mode, trigger) {
  removeTriggers_(MAILOPS.HANDLER.CONTINUE);
  const s = {
    id: (mode === 'dry' ? 'DRY-' : 'PROD-') + stamp_() + '-' + Utilities.getUuid().slice(0, 6),
    mode: mode,
    trigger: trigger,
    startedAt: new Date().toISOString(),
    label: null,
    phase: 'archive',
    pageToken: null,
    offset: 0,
    trashed: 0,
    batches: 0,
    backoffMin: MAILOPS.CONTINUE_DELAY_MIN,
  };
  saveSession_(s);
  setState_({ lastPassStartedAt: Date.now() });
  return s;
}

function endSession_(reason) {
  removeTriggers_(MAILOPS.HANDLER.CONTINUE);
  PropertiesService.getScriptProperties().deleteProperty(MAILOPS.PROP.SESSION);
  if (reason) console.log('MailOps pass ended: ' + reason);
}

function writeChunked_(key, str) {
  const props = PropertiesService.getScriptProperties();
  const size = 8000;
  const n = Math.ceil(str.length / size);
  const old = Number(props.getProperty(key + '_n') || 0);
  const values = {};
  for (let i = 0; i < n; i++) values[key + '_' + i] = str.slice(i * size, (i + 1) * size);
  values[key + '_n'] = String(n);
  props.setProperties(values);
  for (let i = n; i < old; i++) props.deleteProperty(key + '_' + i);
}

function readChunked_(key) {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty(key + '_n') || 0);
  if (!n) return null;
  let s = '';
  for (let i = 0; i < n; i++) {
    const part = props.getProperty(key + '_' + i);
    if (part === null) return null;
    s += part;
  }
  return s;
}
