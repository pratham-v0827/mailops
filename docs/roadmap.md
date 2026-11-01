# Roadmap

| #   | Milestone                                                                 | Done when                                         | Status                     |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------- |
| M0  | Monorepo scaffold: pnpm, CI, licence, docs, shared schema                 | CI green                                          | ✅                         |
| M1  | Firebase project, security rules + emulator tests, indexes                | Rules tests pass in CI                            | ✅ (rules tests run in CI) |
| M2  | Web: Google sign-in, Overview, Rules (read + propose)                     | Log in and see rules                              | ✅ code · ⏳ first deploy  |
| M3  | Engine API + connector tokens; engine library reads config and posts runs | Dry runs appear in the dashboard                  |                            |
| M4  | Proposals → approval → commands (rules, labels, filters, dry runs)        | Web proposal applied by the engine after approval |                            |
| M5  | Labels, Filters (health), Runs/Audit, Settings pages                      | All pages on real data                            |                            |
| M6  | MCP v1 (token): read + propose tools                                      | Claude Desktop/Code proposes a rule end to end    |                            |
| M7  | Monitoring: heartbeat, STALE, failure emails, retention                   | A simulated missed run raises an alert            |                            |
| M8  | Packaging: template copy flow, install + self-host guides                 | New account installs in < 10 min                  |                            |
| M9  | Migrate the first production user (7-day parallel dry run)                | Results match; cut over                           |                            |
| M10 | MCP v2: OAuth 2.1 for claude.ai custom connectors                         | Works as a claude.ai connector                    |                            |
