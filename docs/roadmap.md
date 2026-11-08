# Roadmap

| #   | Milestone                                                                                       | Done when                                          | Status                                   |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| M0  | Monorepo scaffold: pnpm, CI, licence, docs, shared schema                                       | CI green                                           | ✅                                       |
| M1  | Firebase project, security rules + emulator tests, indexes                                      | Rules tests pass in CI                             | ✅                                       |
| M2  | Web: Google sign-in, Overview, Rules                                                            | Log in and see rules                               | ✅                                       |
| M3  | Engine API + connector tokens; the engine posts heartbeats and runs                             | Runs appear in the dashboard                       | ✅                                       |
| M4  | Proposals → approval → commands (rules, labels, filters, passes)                                | A proposal is applied by the engine after approval | ✅ built; check with the first v3 engine |
| M5  | **Sheet-free engine v3**: config from the dashboard, audit events, label/filter mirrors, alerts | Engine tests pass; a dry run appears with activity | ✅ built (13 engine tests)               |
| M6  | Pages: Rules (edit), Activity, Runs, Labels, Filters (health), Proposals, Settings, Setup       | All pages on real data                             | ✅ built                                 |
| M7  | MCP v1 (personal access token): read + propose tools                                            | Claude Code proposes a rule end to end             | ✅ built                                 |
| M8  | Monitoring: heartbeat, STALE, engine failure emails, daily stale-engine check                   | A missed check-in raises an alert                  | ✅ built (email via Resend optional)     |
| M9  | Packaging: pairing setup (no token copy-paste), template copy flow, install guides              | A new account installs in < 10 min                 | ✅ built; template link pending          |
| M10 | MCP v2: OAuth 2.1 (DCR + PKCE) for claude.ai custom connectors                                  | Works as a claude.ai connector                     | ✅ built                                 |
| M11 | Migrate the first production user from the Sheet engine (parallel dry run, then cut over)       | Results match; cut over; Sheet kept read-only      | In progress                              |

## Next

- Publish an engine template (Apps Script project shared view-only) and set `NEXT_PUBLIC_ENGINE_TEMPLATE_URL`.
- API integration tests against the Firestore emulator.
- Rate limiting on unauthenticated endpoints (pairing, OAuth registration).
- Per-label stats charts on the Overview.
