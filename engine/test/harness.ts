/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Runs the Apps Script engine in Node against fakes: an in-memory Gmail (with a small search
 * evaluator for the queries the engine builds), Script Properties, triggers, and a fake dashboard.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const DAY = 86_400_000;

export type FakeMessage = {
  id: string;
  labels: string[]; // label names, or system ids (INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM)
  ageDays: number;
  from?: string;
  subject?: string;
};

export type Api = {
  settings: Record<string, unknown>;
  rules: any[];
  commands: { id: string; payload: any }[];
  down: boolean;
  runs: any[];
  events: any[];
  heartbeats: any[];
  commandResults: Record<string, any>;
  labelMirrors: any[];
  filterMirrors: any[];
  pairApproved: boolean;
};

export function makeEngine(opts: { messages?: FakeMessage[]; userLabels?: string[] } = {}) {
  const now = Date.now();
  const labels: { id: string; name: string; type: string }[] = [
    'INBOX',
    'UNREAD',
    'STARRED',
    'IMPORTANT',
    'TRASH',
    'SPAM',
  ].map((id) => ({ id, name: id, type: 'system' }));
  let nextLabel = 1;
  const addLabel = (name: string) => {
    const l = { id: 'Label_' + nextLabel++, name, type: 'user' };
    labels.push(l);
    return l;
  };
  (opts.userLabels ?? []).forEach(addLabel);
  const idOf = (name: string) => labels.find((l) => l.name === name)?.id;

  const messages = (opts.messages ?? []).map((m) => ({
    id: m.id,
    threadId: m.id,
    internalDate: String(now - m.ageDays * DAY - 3_600_000),
    labelIds: m.labels.map((n) => idOf(n) ?? (labels.some((l) => l.id === n) ? n : addLabel(n).id)),
    from: m.from ?? 'News <news@example.com>',
    subject: m.subject ?? 'Hello',
  }));
  const filters: any[] = [];
  const calls = { modify: 0, trash: 0, get: 0, list: 0 };

  function matches(m: (typeof messages)[number], q: string): boolean {
    const re = /(-?)(label:"((?:[^"\\]|\\.)*)"|in:(\w+)|is:(\w+)|older_than:(\d+)d)/g;
    let ok = true;
    let any = false;
    for (const t of q.matchAll(re)) {
      any = true;
      const neg = t[1] === '-';
      let hit: boolean;
      if (t[3] !== undefined) hit = m.labelIds.includes(idOf(t[3].replace(/\\"/g, '"')) ?? '?');
      else if (t[4]) hit = m.labelIds.includes(t[4].toUpperCase());
      else if (t[5]) hit = m.labelIds.includes(t[5].toUpperCase());
      else hit = now - Number(m.internalDate) > Number(t[6]) * DAY;
      ok = ok && (neg ? !hit : hit);
    }
    return any && ok;
  }

  const props = new Map<string, string>();
  const triggers: { handler: string; kind: string; id: number }[] = [];
  let triggerId = 1;
  const mails: any[] = [];
  const lockBusy = { value: false };

  const api: Api = {
    settings: {},
    rules: [],
    commands: [],
    down: false,
    runs: [],
    events: [],
    heartbeats: [],
    commandResults: {},
    labelMirrors: [],
    filterMirrors: [],
    pairApproved: false,
  };

  const handle = (method: string, path: string, body: any): [number, any] => {
    if (api.down) throw new Error('DNS error');
    if (path === '/api/engine/config')
      return [
        200,
        {
          mailboxId: 'mb_x',
          email: 'me@gmail.com',
          settings: api.settings,
          rules: api.rules,
          pendingCommands: api.commands.length,
          latestEngineVersion: '3.0.0',
        },
      ];
    if (path === '/api/engine/heartbeat') return api.heartbeats.push(body), [200, { ok: true }];
    if (path === '/api/engine/runs') return api.runs.push(body), [200, { ok: true }];
    if (path === '/api/engine/events') return api.events.push(...body.events), [200, { ok: true }];
    if (path === '/api/engine/labels') return api.labelMirrors.push(body), [200, { ok: true }];
    if (path === '/api/engine/filters') return api.filterMirrors.push(body), [200, { ok: true }];
    if (path === '/api/engine/commands' && method === 'get') {
      const c = api.commands;
      api.commands = [];
      return [200, { commands: c }];
    }
    if (path.startsWith('/api/engine/commands/'))
      return (api.commandResults[path.split('/').pop()!] = body), [200, { ok: true }];
    if (path === '/api/engine/pair/start')
      return [
        200,
        {
          deviceCode: 'd'.repeat(43),
          userCode: 'ABCD-EFGH',
          email: 'me@gmail.com',
          expiresInSeconds: 900,
          intervalSeconds: 5,
        },
      ];
    if (path === '/api/engine/pair/poll')
      return [
        200,
        api.pairApproved
          ? {
              status: 'approved',
              token: 'mops_' + 't'.repeat(43),
              mailboxId: 'mb_x',
              email: 'me@gmail.com',
            }
          : { status: 'pending' },
      ];
    return [404, { error: 'not found' }];
  };

  const triggerBuilder = (handler: string) => {
    const t: any = {
      timeBased: () => t,
      after: () => ((t.kind = 'after'), t),
      everyMinutes: () => ((t.kind = 'every'), t),
      atHour: () => ((t.kind = 'daily'), t),
      everyDays: () => t,
      inTimezone: () => t,
      create: () => {
        const tr = { handler, kind: t.kind, id: triggerId++ };
        triggers.push(tr);
        return tr;
      },
    };
    return t;
  };

  const sandbox: any = {
    console: { log: () => {}, warn: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (props.has(k) ? props.get(k)! : null),
        setProperty: (k: string, v: string) => props.set(k, String(v)),
        setProperties: (o: Record<string, string>) =>
          Object.entries(o).forEach(([k, v]) => props.set(k, String(v))),
        deleteProperty: (k: string) => props.delete(k),
        getKeys: () => [...props.keys()],
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => !lockBusy.value, releaseLock: () => {} }),
    },
    Utilities: {
      sleep: () => {},
      getUuid: () => Math.random().toString(16).slice(2).padEnd(12, '0'),
      formatDate: (d: Date) =>
        d
          .toISOString()
          .replace(/[-:T]/g, '')
          .slice(0, 15)
          .replace(/^(\d{8})/, '$1-'),
    },
    ScriptApp: {
      newTrigger: triggerBuilder,
      getProjectTriggers: () =>
        triggers.map((t) => ({ getHandlerFunction: () => t.handler, _id: t.id })),
      deleteTrigger: (t: any) => {
        const i = triggers.findIndex((x) => x.id === t._id);
        if (i >= 0) triggers.splice(i, 1);
      },
      getIdentityToken: () => 'id.token.value-long-enough',
    },
    UrlFetchApp: {
      fetch: (url: string, o: any) => {
        const path = url.replace(/^https?:\/\/[^/]+/, '');
        const [code, data] = handle(o.method, path, o.payload ? JSON.parse(o.payload) : null);
        return { getResponseCode: () => code, getContentText: () => JSON.stringify(data) };
      },
    },
    MailApp: { sendEmail: (m: any) => mails.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@gmail.com' }) },
    Gmail: {
      Users: {
        getProfile: () => ({ emailAddress: 'me@gmail.com' }),
        Labels: {
          list: () => ({ labels: labels.map((l) => ({ ...l })) }),
          get: (_me: string, id: string) => ({
            id,
            messagesTotal: messages.filter((m) => m.labelIds.includes(id)).length,
            messagesUnread: 0,
          }),
          create: (body: any) => addLabel(body.name),
        },
        Messages: {
          list: (_me: string, args: any) => {
            calls.list++;
            const hits = messages.filter((m) => matches(m, args.q));
            const start = args.pageToken ? Number(args.pageToken) : 0;
            const page = hits.slice(start, start + (args.maxResults ?? 100));
            const next =
              start + page.length < hits.length ? String(start + page.length) : undefined;
            return {
              messages: page.map((m) => ({ id: m.id, threadId: m.threadId })),
              nextPageToken: next,
              resultSizeEstimate: hits.length,
            };
          },
          get: (_me: string, id: string) => {
            calls.get++;
            const m = messages.find((x) => x.id === id)!;
            return {
              id: m.id,
              threadId: m.threadId,
              labelIds: [...m.labelIds],
              internalDate: m.internalDate,
              payload: {
                headers: [
                  { name: 'From', value: m.from },
                  { name: 'Subject', value: m.subject },
                ],
              },
            };
          },
          modify: (body: any, _me: string, id: string) => {
            calls.modify++;
            const m = messages.find((x) => x.id === id)!;
            m.labelIds = m.labelIds.filter((l) => !(body.removeLabelIds ?? []).includes(l));
            return m;
          },
          trash: (_me: string, id: string) => {
            calls.trash++;
            const m = messages.find((x) => x.id === id)!;
            m.labelIds = [...m.labelIds.filter((l) => l !== 'INBOX'), 'TRASH'];
            return m;
          },
        },
        Settings: {
          Filters: {
            list: () => ({ filter: filters }),
            create: (f: any) => (filters.push({ id: 'f' + filters.length, ...f }), f),
          },
        },
      },
    },
  };
  createContext(sandbox);
  for (const f of readdirSync(SRC).filter((n) => n.endsWith('.js'))) {
    runInContext(readFileSync(join(SRC, f), 'utf8'), sandbox, { filename: f });
  }

  return {
    g: sandbox as Record<string, (...a: any[]) => any>,
    api,
    props,
    triggers,
    mails,
    filters,
    calls,
    message: (id: string) => {
      const m = messages.find((x) => x.id === id)!;
      return m.labelIds.map((l) => labels.find((x) => x.id === l)?.name ?? l);
    },
    connect: () => props.set('MAILOPS_TOKEN', 'mops_' + 't'.repeat(43)),
    lockBusy,
    breakFilters: () => {
      sandbox.Gmail.Users.Settings.Filters.list = () => {
        throw new Error('Backend Error');
      };
    },
  };
}

export function rule(label: string, over: Record<string, unknown> = {}) {
  return {
    label,
    enabled: true,
    archiveAfterDays: null,
    trashAfterDays: null,
    neverDelete: false,
    protectUnread: false,
    protectStarred: true,
    changedAt: '2020-01-01T00:00:00.000Z',
    ...over,
  };
}
