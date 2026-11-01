# Contributing

Thanks for helping! MailOps is early. Check the [roadmap](docs/roadmap.md) and open an issue before starting anything large.

## Setup

```bash
# Node 20+ (see .nvmrc). pnpm via corepack, no global install needed:
corepack pnpm install
corepack pnpm check        # format, typecheck, tests (same as CI)
```

## Ground rules

- **Safety first.** Nothing may permanently delete email, labels or filters. New behaviour that changes Gmail must support dry run and default to it.
- **Schema first.** Rules, settings and proposals are defined once in `packages/schema` and reused everywhere. Change them there, with tests.
- **No secrets or personal data** in code, tests, fixtures or screenshots. Use `example.com` addresses.
- Keep PRs small, run `pnpm check`, and describe how you tested.

## Layout

| Path              | What                                                        |
| ----------------- | ----------------------------------------------------------- |
| `apps/web`        | Next.js dashboard, API and MCP endpoint (Vercel)            |
| `engine`          | Apps Script library that runs in each user's Google account |
| `packages/schema` | Shared zod schemas                                          |
| `firebase`        | Firestore rules and indexes                                 |
| `docs`            | Architecture, roadmap, guides                               |
