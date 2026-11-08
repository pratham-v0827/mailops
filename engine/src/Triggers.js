/** The engine's schedule: a 15-minute sync and the nightly pass at the configured hour. */
function ensureTriggers_(settings) {
  const triggers = ScriptApp.getProjectTriggers();
  const has = function (h) {
    return triggers.some(function (t) {
      return t.getHandlerFunction() === h;
    });
  };
  if (!has(MAILOPS.HANDLER.SYNC)) {
    ScriptApp.newTrigger(MAILOPS.HANDLER.SYNC)
      .timeBased()
      .everyMinutes(MAILOPS.SYNC_MINUTES)
      .create();
  }
  const hour = Math.max(0, Math.min(23, Number(settings.dailyHour)));
  const tz = String(settings.timezone || 'UTC');
  const key = hour + '|' + tz;
  const st = getState_();
  if (st.nightlyKey !== key || !has(MAILOPS.HANDLER.NIGHTLY)) {
    removeTriggers_(MAILOPS.HANDLER.NIGHTLY);
    ScriptApp.newTrigger(MAILOPS.HANDLER.NIGHTLY)
      .timeBased()
      .atHour(hour)
      .everyDays(1)
      .inTimezone(tz)
      .create();
    setState_({ nightlyKey: key });
  }
  if (!st.installedAt) setState_({ installedAt: Date.now() });
}

/** Removes this engine's triggers for one handler, or all of them when `handler` is null. */
function removeTriggers_(handler) {
  const mine = [MAILOPS.HANDLER.SYNC, MAILOPS.HANDLER.NIGHTLY, MAILOPS.HANDLER.CONTINUE];
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const h = t.getHandlerFunction();
    if (handler ? h === handler : mine.indexOf(h) >= 0) {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  return n;
}

function log_(msg) {
  console.log(msg);
}
