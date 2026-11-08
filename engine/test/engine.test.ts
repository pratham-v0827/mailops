import { describe, expect, it } from 'vitest';
import { makeEngine, rule } from './harness';

const PROD = { automationEnabled: true, dryRun: false };

function setupNews(
  settings: Record<string, unknown>,
  extra: Parameters<typeof makeEngine>[0] = {},
) {
  const e = makeEngine({
    userLabels: ['News', 'Keep', 'Bank'],
    messages: [
      { id: 'old-inbox', labels: ['News', 'INBOX'], ageDays: 10 }, // archive due (7)
      { id: 'ancient', labels: ['News', 'INBOX'], ageDays: 40 }, // trash due (30)
      { id: 'fresh', labels: ['News', 'INBOX'], ageDays: 2 }, // nothing due
      { id: 'starred', labels: ['News', 'INBOX', 'STARRED'], ageDays: 40 },
      { id: 'important', labels: ['News', 'INBOX', 'IMPORTANT'], ageDays: 40 },
      { id: 'kept', labels: ['News', 'INBOX', 'Keep'], ageDays: 40 },
      { id: 'also-bank', labels: ['News', 'Bank', 'INBOX'], ageDays: 40 }, // Bank never deletes
      ...(extra.messages ?? []),
    ],
  });
  e.connect();
  e.api.settings = settings;
  e.api.rules = [
    rule('News', { archiveAfterDays: 7, trashAfterDays: 30 }),
    rule('Bank', { archiveAfterDays: 30, neverDelete: true }),
  ];
  return e;
}

describe('dry run', () => {
  it('changes nothing in Gmail and reports what it would do', () => {
    const e = setupNews({ automationEnabled: true, dryRun: true });
    e.g.runDryRunNow!();
    expect(e.calls.modify + e.calls.trash).toBe(0);
    const byId = Object.fromEntries(e.api.events.map((x) => [x.messageId, x]));
    expect(byId['old-inbox']).toMatchObject({ action: 'archive', preview: true, mode: 'dry' });
    expect(byId['ancient']).toMatchObject({ action: 'trash', preview: true });
    // Guarded messages are excluded by the search itself, so they are never even read.
    expect(byId['starred']).toBeUndefined();
    expect(byId['kept']).toBeUndefined();
    expect(byId['fresh']).toBeUndefined();
    expect(e.api.runs.at(-1)).toMatchObject({ mode: 'dry', status: 'SUCCESS', errors: 0 });
  });

  it('never sends subjects unless the mailbox opts in', () => {
    const e = setupNews({ dryRun: true });
    e.g.runDryRunNow!();
    expect(e.api.events.every((x) => x.subject === undefined)).toBe(true);
    expect(e.api.events[0].senderDomain).toBe('example.com');

    const f = setupNews({ dryRun: true, storeSubjects: true });
    f.g.runDryRunNow!();
    expect(f.api.events[0].subject).toBe('Hello');
  });
});

describe('production pass', () => {
  it('archives and trashes by rule, and respects every guard', () => {
    const e = setupNews(PROD);
    e.g.mailopsNightly!();
    expect(e.message('old-inbox')).not.toContain('INBOX');
    expect(e.message('ancient')).toContain('TRASH');
    expect(e.message('fresh')).toContain('INBOX');
    // Global guard: starred, Important and "Keep" are untouched.
    for (const id of ['starred', 'important', 'kept']) {
      expect(e.message(id)).toContain('INBOX');
      expect(e.message(id)).not.toContain('TRASH');
    }
    // Multi-label: Bank is Never Delete, so the cautious policy wins (archive only).
    expect(e.message('also-bank')).not.toContain('TRASH');
    expect(e.message('also-bank')).not.toContain('INBOX');
    expect(e.api.runs.at(-1)).toMatchObject({ mode: 'prod', status: 'SUCCESS', trashed: 1 });
  });

  it('refuses production when settings say dry run, even for a production pass', () => {
    const e = setupNews(PROD);
    e.g.startSession_!('prod', 'TEST');
    e.api.settings = { automationEnabled: true, dryRun: true };
    e.g.mailopsContinue!();
    expect(e.calls.modify + e.calls.trash).toBe(0);
    expect(e.api.runs.at(-1).status).toBe('SKIPPED');
  });

  it('does nothing at night when automation is off', () => {
    const e = setupNews({ automationEnabled: false, dryRun: false });
    e.g.mailopsNightly!();
    expect(e.calls.list).toBe(0);
    expect(e.api.runs.at(-1).status).toBe('SKIPPED');
  });

  it('previews a recently changed rule instead of acting on it', () => {
    const e = setupNews(PROD);
    e.api.rules[0].changedAt = new Date().toISOString();
    e.g.mailopsNightly!();
    expect(e.message('ancient')).not.toContain('TRASH');
    expect(e.api.events.find((x) => x.messageId === 'ancient')).toMatchObject({
      action: 'trash',
      preview: true,
    });
  });

  it('stops trashing at the per-pass limit', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: 'bulk' + i,
      labels: ['News'],
      ageDays: 50,
    }));
    const e = setupNews({ ...PROD, maxTrashPerPass: 2 }, { messages: many });
    e.g.mailopsNightly!();
    expect(e.calls.trash).toBe(2);
    expect(e.api.runs.at(-1).notes).toContain('Trash limit');
  });

  it('fails closed when the protected label is missing', () => {
    const e = makeEngine({
      userLabels: ['News'],
      messages: [{ id: 'a', labels: ['News'], ageDays: 99 }],
    });
    e.connect();
    e.api.settings = PROD;
    e.api.rules = [rule('News', { trashAfterDays: 30 })];
    expect(() => e.g.mailopsNightly!()).toThrow(/Protected label/);
    expect(e.calls.trash).toBe(0);
    expect(e.api.runs.at(-1).status).toBe('FAILED');
    expect(e.mails).toHaveLength(1);
  });
});

describe('batches', () => {
  it('resumes where it stopped and looks at each message once per pass', () => {
    const msgs = Array.from({ length: 25 }, (_, i) => ({
      id: 'm' + String(i).padStart(2, '0'),
      labels: ['News', 'INBOX'],
      ageDays: 10,
    }));
    const e = makeEngine({ userLabels: ['News', 'Keep'], messages: msgs });
    e.connect();
    e.api.settings = { dryRun: true, maxMessagesPerBatch: 10 };
    e.api.rules = [rule('News', { archiveAfterDays: 7 })];
    e.g.runDryRunNow!();
    expect(e.triggers.some((t) => t.handler === 'mailopsContinue')).toBe(true);
    for (let i = 0; i < 5 && e.props.has('MAILOPS_SESSION'); i++) e.g.mailopsContinue!();
    expect(e.props.has('MAILOPS_SESSION')).toBe(false);
    const ids = e.api.events.map((x) => x.messageId);
    expect(new Set(ids).size).toBe(25);
    expect(ids).toHaveLength(25);
    expect(e.api.runs.map((r) => r.status)).toEqual(['CONTINUING', 'CONTINUING', 'SUCCESS']);
    expect(new Set(e.api.runs.map((r) => r.sessionId)).size).toBe(1);
  });
});

describe('robustness', () => {
  it('retries a batch later when another execution holds the lock', () => {
    const e = setupNews({ dryRun: true });
    e.g.startSession_!('dry', 'TEST');
    e.lockBusy.value = true;
    expect(e.g.mailopsContinue!()).toContain('retrying');
    expect(e.triggers.filter((t) => t.handler === 'mailopsContinue')).toHaveLength(1);
    e.lockBusy.value = false;
    e.g.mailopsContinue!();
    expect(e.props.has('MAILOPS_SESSION')).toBe(false);
  });

  it('a failing sync step does not fail the sync or skip the others', () => {
    const e = setupNews({ dryRun: true });
    e.breakFilters();
    e.api.commands = [{ id: 'c1', payload: { kind: 'label.create', label: 'X' } }];
    const r = e.g.mailopsSync!();
    expect(r).toContain('mirrors');
    expect(e.api.commandResults.c1.ok).toBe(true);
    expect(e.triggers.some((t) => t.handler === 'mailopsSync')).toBe(true);
  });
});

describe('config', () => {
  it('drops invalid rules instead of guessing', () => {
    const e = makeEngine();
    const cfg = e.g.normaliseConfig_!({
      settings: { dryRun: 'no' },
      rules: [
        rule('Good', { archiveAfterDays: 3 }),
        rule('Bad', { neverDelete: true, trashAfterDays: 5 }),
        rule('Backwards', { archiveAfterDays: 30, trashAfterDays: 7 }),
        { label: '' },
      ],
    });
    expect(cfg.rules.map((r: { label: string }) => r.label)).toEqual(['Good']);
    expect(cfg.droppedRules).toHaveLength(3);
    expect(cfg.settings.dryRun).toBe(true); // wrong type → safe default
  });

  it('keeps working from the cached config when the dashboard is down', () => {
    const e = setupNews({ dryRun: true });
    e.g.loadConfig_!(true);
    e.api.down = true;
    const cfg = e.g.loadConfig_!(true);
    expect(cfg.fromCache).toBe(true);
    expect(cfg.rules).toHaveLength(2);
  });
});

describe('sync and commands', () => {
  it('applies commands, installs the schedule and mirrors labels and filters', () => {
    const e = setupNews({ dryRun: true, dailyHour: 4, timezone: 'Asia/Kolkata' });
    e.api.commands = [
      { id: 'c1', payload: { kind: 'label.create', label: 'Receipts/2026/Shops' } },
      {
        id: 'c2',
        payload: {
          kind: 'filter.create',
          criteria: { from: 'shop@example.com' },
          addLabel: 'Receipts/2026/Shops',
          archive: true,
        },
      },
      { id: 'c3', payload: { kind: 'run.start', mode: 'prod' } },
      { id: 'c4', payload: { kind: 'run.start', mode: 'dry' } },
      { id: 'c5', payload: { kind: 'mail.delete' } },
    ];
    expect(e.g.mailopsSync!()).toBe('ok');
    expect(e.api.commandResults.c1.ok).toBe(true);
    expect(e.api.commandResults.c2).toMatchObject({ ok: true });
    expect(e.filters[0].action.removeLabelIds).toEqual(['INBOX']);
    expect(e.api.commandResults.c3).toMatchObject({ ok: false });
    expect(e.api.commandResults.c4.ok).toBe(true);
    expect(e.api.commandResults.c5).toMatchObject({ ok: false });
    const handlers = e.triggers.map((t) => t.handler).sort();
    expect(handlers).toEqual(['mailopsContinue', 'mailopsNightly', 'mailopsSync']);
    expect(
      e.api.labelMirrors.at(-1).labels.some((l: { name: string }) => l.name === 'Receipts/2026'),
    ).toBe(true);
    expect(e.api.filterMirrors.at(-1)).toMatchObject({ complete: true });
    // A second identical filter is not created.
    e.api.commands = [
      {
        id: 'c6',
        payload: e.api.commands[1]?.payload ?? {
          kind: 'filter.create',
          criteria: { from: 'shop@example.com' },
          addLabel: 'Receipts/2026/Shops',
          archive: true,
        },
      },
    ];
    e.g.mailopsSync!();
    expect(e.filters).toHaveLength(1);
  });

  it('pairs with the dashboard during setup', () => {
    const e = setupNews({ dryRun: true });
    e.props.clear();
    e.api.pairApproved = true;
    const msg = e.g.setup!();
    expect(msg).toContain('Connected as me@gmail.com');
    expect(e.props.get('MAILOPS_TOKEN')).toMatch(/^mops_/);
    expect(e.triggers.map((t) => t.handler)).toContain('mailopsNightly');
  });
});
