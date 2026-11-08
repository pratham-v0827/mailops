# Using MailOps from Claude (MCP)

MailOps has an MCP server at `https://<your-dashboard>/api/mcp` (Streamable HTTP). Claude can read your mailboxes and **propose** changes. You approve each proposal on the dashboard's **Proposals** page, and only then does the engine act. Claude can't approve, delete anything, or turn production on, and never sees email content.

## Connect

**claude.ai or Claude Desktop (custom connector, OAuth).** _Settings → Connectors → Add custom connector_, URL `https://<your-dashboard>/api/mcp`. Claude opens a MailOps sign-in page: sign in with Google and click **Allow**. No token to copy. To disconnect: dashboard _Settings → Claude (MCP) access → Disconnect connectors_.

**Claude Code (personal access token).** Dashboard _Settings → Claude (MCP) access → Create token_, then:

```bash
claude mcp add --transport http mailops https://<your-dashboard>/api/mcp --header "Authorization: Bearer mcp_…"
```

Any MCP client that supports Streamable HTTP with a bearer header works the same way.

## Tools

| Tool              | Scope   | What                                                                |
| ----------------- | ------- | ------------------------------------------------------------------- |
| `list_mailboxes`  | read    | Your Gmail accounts, engine status, mode                            |
| `list_rules`      | read    | Lifecycle rules (optionally filtered by label)                      |
| `get_settings`    | read    | Mode, guards, schedule, privacy                                     |
| `list_labels`     | read    | User labels, message counts, whether a rule covers each             |
| `list_filters`    | read    | Gmail filters with 30-day health (`unhealthyOnly` to find leaks)    |
| `recent_activity` | read    | Per-message decisions: action, label, sender domain, age            |
| `recent_runs`     | read    | Engine batches with counts                                          |
| `list_proposals`  | read    | Pending or decided proposals                                        |
| `propose_rule`    | propose | Create or change one label's rule                                   |
| `propose_label`   | propose | Create a Gmail label                                                |
| `propose_filter`  | propose | Create a filter that labels (and optionally archives) matching mail |
| `propose_dry_run` | propose | Ask for a full preview pass                                         |

Every tool takes `mailbox`: its id (`mb_…`) or its Gmail address.

## Example prompts

- _"Which of my filters are leaking mail? Propose fixes."_
- _"Propose a rule for Newsletters/Weekly: archive after 3 days, trash after 30."_
- _"What did MailOps move to Trash last night, by sender domain?"_
- _"Which labels have no lifecycle rule and more than 500 messages?"_

## Protocol notes

- **Stateless.** Every `POST` carries one JSON-RPC message or a batch, and gets a JSON answer. `GET` returns 405, because the server never streams.
- **Protocol versions:** 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05. The server echoes the client's version when it supports it.
- **Auth:**
  - On 401, the response's `WWW-Authenticate` header points to `/.well-known/oauth-protected-resource` (RFC 9728).
  - The authorization server metadata is at `/.well-known/oauth-authorization-server` (RFC 8414).
  - Clients register themselves dynamically (RFC 7591) and use PKCE S256.
  - Access tokens last 1 hour. Refresh tokens last 30 days and are rotated on every use.
