# MailOps engine

The engine is a Google Apps Script that runs **in each user's own Google account** and does all the Gmail work: archiving, moving to Trash, labels and filters. The dashboard never gets Gmail access. There is no spreadsheet: rules and settings live on the dashboard, and the engine fetches them.

## Install (about 5 minutes)

1. **Get a copy of the engine.** Either:
   - open the template link on your dashboard's **Setup** page → **Overview** (ⓘ) → **Make a copy**, or
   - create a project at [script.new](https://script.new) and push this folder with [clasp](https://github.com/google/clasp):
     ```bash
     cd engine
     cp .clasp.json.example .clasp.json   # put your new project's scriptId in it
     npx @google/clasp@3.4.0 push --force
     ```
2. **Run `setup`.** In the editor, choose `setup` next to **Debug** and click **Run**. Approve Google's prompt: _Review permissions → your account → Advanced → Go to … (unsafe) → Allow_. "Unsafe" only means Google hasn't reviewed your private copy.
3. **Approve the code.** The execution log prints a link like `https://<dashboard>/pair?code=ABCD-EFGH`. Open it and click **Approve and connect**. Setup then finishes by itself and installs the schedule.

Using your own dashboard? Before step 2, add the Script Property `MAILOPS_URL` = your dashboard URL (_Project Settings → Script properties_).

## What it does

| Trigger           | When                            | What                                                                                                                                                         |
| ----------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mailopsSync`     | every 15 minutes                | heartbeat; refresh rules and settings; carry out queued commands; send the label and filter lists (daily) and filter health; keep the schedule; raise alerts |
| `mailopsNightly`  | daily at `dailyHour` (settings) | starts a lifecycle pass: production if automation is on and dry run is off, otherwise a dry run                                                              |
| `mailopsContinue` | a few minutes after each batch  | runs the next batch of a pass (each batch stays under ~4 minutes)                                                                                            |

**Editor functions:**

| Function       | What it does                                                         |
| -------------- | -------------------------------------------------------------------- |
| `setup`        | Pairs with the dashboard and installs the triggers. Safe to re-run.  |
| `status`       | Logs the connection, mode, schedule and any pass in progress.        |
| `runDryRunNow` | Starts a full dry run (preview only).                                |
| `stopRun`      | Stops the pass in progress.                                          |
| `disconnect`   | Forgets the dashboard and removes the triggers. Gmail isn't touched. |

## Safety

The engine enforces these itself, whatever the dashboard sends:

- **Dry run by default.** Production only when the mailbox's settings say automation on and dry run off. A production pass re-checks this before every batch.
- **Trash, never delete.** "Trash" is Gmail Trash, recoverable for 30 days. There's no permanent delete anywhere in the code.
- **Global guard:** starred, Important and the protected label (default `Keep`) are never archived or trashed. They're excluded in the search and checked again per message. If the protected label is missing, the run fails closed.
- **Most cautious rule wins** when a message has several labels: the longest ages, and _Never Delete_ beats any trash age.
- **Changed rules preview first** (`newRulePreviewHours`, default 24 h), and a pass trashes at most `maxTrashPerPass` messages (default 250).
- **Metadata only.** Messages are read with `format: metadata` (labels, date, From, Subject). Bodies are never fetched. The dashboard gets counts, the sender's domain and the label; subjects only if you opt in.
- **Dashboard outage:** the engine uses its cached config, and production stops if the dashboard has been unreachable for 3 days.
- **Labels and filters:** created only by commands you approve. Nothing is renamed or deleted.

## Permissions

| Scope                      | Why                                                             |
| -------------------------- | --------------------------------------------------------------- |
| `gmail.modify`             | Archive, move to Trash, create labels, read metadata            |
| `gmail.settings.basic`     | Create the filters you approve; list filters                    |
| `script.external_request`  | Talk to the dashboard                                           |
| `script.scriptapp`         | Install its own triggers                                        |
| `script.send_mail`         | Email you when a run fails or a pass is overdue                 |
| `userinfo.email`, `openid` | Prove to the dashboard which Gmail account it runs in (pairing) |

## Updating

The dashboard shows when a newer engine is available. Replace the files in your project with the new [`src`](src) files (or `clasp push`). Script Properties, so your connection, are kept. Run `setup` once afterwards.

## Development

```bash
corepack pnpm --filter @mailops/engine test
```

The tests run the real engine files in Node against a fake Gmail, Script Properties and dashboard ([`test/harness.ts`](test/harness.ts)): dry runs change nothing, guards hold, multi-label policy, resumable batches, previews, the trash limit, commands and pairing.

`connector-v2/Connector.js` is the M3 connector for the older Sheet-based engine (v2.x). It's kept for that engine only.

## API

All engine calls use `Authorization: Bearer mops_…` (the connector token the engine receives at pairing).

| Endpoint                         | Body / result                                                                |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `POST /api/engine/pair/start`    | `{ identityToken, engineVersion }` → `{ deviceCode, userCode, … }` (no auth) |
| `POST /api/engine/pair/poll`     | `{ deviceCode }` → `{ status }`, then the token once (no auth)               |
| `GET /api/engine/config`         | → `{ settings, rules (with changedAt), pendingCommands, … }`                 |
| `POST /api/engine/heartbeat`     | `EngineHeartbeat` (with `state`)                                             |
| `POST /api/engine/runs`          | `EngineRunReport` (idempotent per `runId`)                                   |
| `POST /api/engine/events`        | `{ events: EngineEvent[] }` (≤ 500)                                          |
| `GET /api/engine/commands`       | → `{ commands: [{ id, payload }] }`                                          |
| `POST /api/engine/commands/{id}` | `{ ok, message }`                                                            |
| `POST /api/engine/labels`        | `{ labels }`                                                                 |
| `POST /api/engine/filters`       | `{ filters, complete }`                                                      |

Schemas: [`packages/schema`](../packages/schema/src/index.ts).
