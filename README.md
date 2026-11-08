# MailOps

**Open-source Gmail automation, without handing your inbox to a server.**

MailOps keeps Gmail tidy with simple per-label rules: _archive after N days_, _move to Trash after M days_, or _keep forever_. You manage everything from a clean web dashboard, or from **Claude**, through the MailOps MCP server.

> **Status: beta.** The Gmail engine logic has run in production for one user since Sept 2026; engine v3 (no spreadsheet), the dashboard and the MCP server are new. See the [roadmap](docs/roadmap.md).

## Get started

1. Sign in to your MailOps dashboard (or [self-host one](docs/self-hosting.md)).
2. Follow **Setup**: copy the engine into your Google account, run `setup`, approve the code. [Engine guide](engine/README.md).
3. Add rules, start a dry run, check **Activity**, then turn on production in **Settings**.
4. Optional: [connect Claude](docs/mcp.md).

## How it works

```mermaid
flowchart LR
  E[Your Apps Script<br/>MailOps engine] -- archive / trash / labels / filters --> G[(Your Gmail)]
  E <-- rules & approved changes / runs & heartbeat --> A[MailOps API<br/>Vercel]
  W[Dashboard] --> A
  C[Your Claude<br/>via MCP] -- read & propose --> A
  A --> F[(Firestore)]
```

- **Your Gmail stays yours.** The engine runs as an Apps Script in _your_ Google account. The web app only uses basic Google sign-in and never gets Gmail access.
- **Safe by default.**
  - dry run first
  - move to Trash, never permanent delete
  - starred, Important and `Keep`-labelled mail is never touched
  - every change made from the web or Claude is a **proposal you approve**.
- **Free to run.** Fits the Firebase Spark and Vercel Hobby free tiers, and Apps Script quotas. Self-host with your own Firebase and Vercel.
- **Claude-native.** Ask Claude to _"add a rule that trashes promo mail from my bank after 90 days"_. It proposes; you approve in the dashboard.

## Repository

| Path                                 | What                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web)               | Next.js dashboard, API routes, MCP endpoint (Vercel)                                                                       |
| [`engine`](engine)                   | Apps Script engine that runs in each user's account (tested in Node)                                                       |
| [`packages/schema`](packages/schema) | Shared zod schemas: rules, settings, proposals                                                                             |
| [`firebase`](firebase)               | Firestore security rules and indexes                                                                                       |
| [`docs`](docs)                       | [Architecture](docs/architecture.md), [MCP](docs/mcp.md), [self-hosting](docs/self-hosting.md), [roadmap](docs/roadmap.md) |

## Development

```bash
corepack pnpm install
corepack pnpm check      # format + typecheck + tests (same as CI)
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
