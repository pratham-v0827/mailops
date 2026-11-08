# engine

The MailOps engine runs as Google Apps Script **in each user's own Google account** and does all the Gmail work: archiving, moving to Trash, labels and filters. The dashboard never gets Gmail access.

## Dashboard connector (M3)

[`src/Connector.js`](src/Connector.js) connects any Apps Script engine to the dashboard. Drop it into the project.

| Function                                                      | What it does                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `mailopsConnectDashboard()`                                   | Sheet menu action: prompts for the connector token, stores it in Script Properties, checks in, and shows the rule count the dashboard has |
| `mailopsHeartbeat_({engineVersion, mode, automationEnabled})` | Checks in. Sends the account's Gmail address, which the API compares with the mailbox's address to prove ownership                        |
| `mailopsReportRun_(run)`                                      | Reports one run: ISO timestamps and integer counts, never email content (see `EngineRunReport` in `@mailops/schema`)                      |
| `mailopsFetchConfig_()`                                       | Pulls the mailbox's settings and rules                                                                                                    |
| `mailopsDisconnectDashboard()`                                | Forgets the token                                                                                                                         |

All calls are best-effort: they return `{ ok, data | error }` and never throw into the engine, so a dashboard outage can't break a run.

**Requirements:**

- the OAuth scope `https://www.googleapis.com/auth/script.external_request` (for `UrlFetchApp`)
- the Gmail advanced service (for `Gmail.Users.getProfile`).

## API

| Endpoint                     | Auth            | Body                                                  |
| ---------------------------- | --------------- | ----------------------------------------------------- |
| `POST /api/engine/heartbeat` | `Bearer mops_…` | `EngineHeartbeat`                                     |
| `POST /api/engine/runs`      | `Bearer mops_…` | `EngineRunReport` (idempotent per `runId`)            |
| `GET /api/engine/config`     | `Bearer mops_…` | → `{ mailboxId, email, settings, rules, serverTime }` |

Tokens are issued per mailbox on the dashboard (Overview → Engine connection), shown once, stored as SHA-256 hashes, and revocable. Runs are rejected until a heartbeat from the right Gmail account has verified the mailbox.

## Roadmap

The full engine (rules lifecycle, safety guards, resumable quota-aware batches) is being ported from a production single-user version as an Apps Script **library**. `engine-template/` will be the small script users copy.
