/** Engine constants. Rules and settings are not here: they come from the dashboard. */
const MAILOPS = {
  VERSION: '3.0.0',
  DEFAULT_URL: 'https://mailops-gamma.vercel.app',
  PROP: {
    TOKEN: 'MAILOPS_TOKEN',
    URL: 'MAILOPS_URL',
    CONFIG: 'MAILOPS_CONFIG',
    SESSION: 'MAILOPS_SESSION',
    STATE: 'MAILOPS_STATE',
  },
  HANDLER: {
    SYNC: 'mailopsSync',
    NIGHTLY: 'mailopsNightly',
    CONTINUE: 'mailopsContinue',
  },
  SYNC_MINUTES: 15,
  /** A cached config older than this is not used for production work. */
  CONFIG_MAX_AGE_MS: 3 * 24 * 3600 * 1000,
  /** Settings used when the dashboard sends none (same safe defaults as @mailops/schema). */
  DEFAULT_SETTINGS: {
    automationEnabled: false,
    dryRun: true,
    neverTouchStarred: true,
    neverTouchImportant: true,
    protectedLabel: 'Keep',
    storeSubjects: false,
    retentionDays: 90,
    staleAfterHours: 26,
    timezone: 'UTC',
    dailyHour: 3,
    maxMessagesPerBatch: 100,
    maxRuntimeSeconds: 210,
    maxTrashPerPass: 250,
    newRulePreviewHours: 24,
    emailAlerts: true,
  },
  /** Gmail API pacing (units per batch, ms between calls). */
  GMAIL_UNIT_BUDGET: 4200,
  GMAIL_CALL_GAP_MS: 220,
  CONTINUE_DELAY_MIN: 2,
  BACKOFF_MAX_MIN: 15,
};

function dashboardUrl_() {
  const u = PropertiesService.getScriptProperties().getProperty(MAILOPS.PROP.URL);
  return String(u || MAILOPS.DEFAULT_URL).replace(/\/+$/, '');
}

function isConnected_() {
  return !!PropertiesService.getScriptProperties().getProperty(MAILOPS.PROP.TOKEN);
}

function clearConnection_() {
  PropertiesService.getScriptProperties().deleteProperty(MAILOPS.PROP.TOKEN);
}

/**
 * Returns {settings, rules, ...} from the dashboard, cached in Script Properties. If the dashboard
 * can't be reached, the cached copy is used (flagged `fromCache`), so a dashboard outage never
 * stops the nightly pass, and a bad response never replaces a good cached config.
 */
function loadConfig_(refresh) {
  const cached = readCachedConfig_();
  if (refresh || !cached) {
    const res = apiRequest_('get', '/api/engine/config', null);
    if (res.ok) {
      const cfg = normaliseConfig_(res.data);
      if (cfg) {
        writeChunked_(MAILOPS.PROP.CONFIG, JSON.stringify({ fetchedAt: Date.now(), config: cfg }));
        cfg.fromCache = false;
        return cfg;
      }
      console.warn('MailOps: the dashboard sent an invalid config; keeping the cached one.');
    } else {
      console.warn('MailOps: could not fetch config (' + res.error + ').');
    }
  }
  if (!cached) throw new Error('No configuration yet: run setup to connect to the dashboard.');
  const cfg = cached.config;
  cfg.fromCache = true;
  cfg.cacheAgeMs = Date.now() - cached.fetchedAt;
  return cfg;
}

function readCachedConfig_() {
  const raw = readChunked_(MAILOPS.PROP.CONFIG);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/** Validates the dashboard's config defensively; invalid rules are dropped, not guessed at. */
function normaliseConfig_(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.rules)) return null;
  const s = {};
  const d = MAILOPS.DEFAULT_SETTINGS;
  const given = data.settings || {};
  Object.keys(d).forEach(function (k) {
    s[k] = typeof given[k] === typeof d[k] ? given[k] : d[k];
  });
  const days = function (v) {
    return v === null || v === undefined
      ? null
      : typeof v === 'number' && v >= 0 && v <= 36500 && Math.floor(v) === v
        ? v
        : undefined;
  };
  const rules = [];
  const dropped = [];
  data.rules.forEach(function (r) {
    const label = r && typeof r.label === 'string' ? r.label.trim() : '';
    const a = days(r && r.archiveAfterDays);
    const t = days(r && r.trashAfterDays);
    if (!label || a === undefined || t === undefined || (r.neverDelete && t !== null)) {
      dropped.push(label || '(no label)');
      return;
    }
    if (a !== null && t !== null && t < a) {
      dropped.push(label);
      return;
    }
    rules.push({
      label: label,
      enabled: r.enabled !== false,
      archiveAfterDays: a,
      trashAfterDays: t,
      neverDelete: !!r.neverDelete,
      protectUnread: !!r.protectUnread,
      protectStarred: r.protectStarred !== false,
      changedAt: typeof r.changedAt === 'string' ? r.changedAt : null,
    });
  });
  rules.sort(function (x, y) {
    return x.label < y.label ? -1 : x.label > y.label ? 1 : 0;
  });
  return {
    mailboxId: String(data.mailboxId || ''),
    email: String(data.email || ''),
    settings: s,
    rules: rules,
    droppedRules: dropped,
    pendingCommands: Number(data.pendingCommands || 0),
    latestEngineVersion: String(data.latestEngineVersion || ''),
  };
}

function isProduction_(settings) {
  return settings.automationEnabled === true && settings.dryRun === false;
}
