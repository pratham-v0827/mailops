# Security policy

MailOps automates Gmail, so we treat security reports as a priority.

## Reporting a vulnerability

Please **don't open a public issue.** Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository. We aim to acknowledge reports within 72 hours.

## Design principles

- **No central Gmail access.** The hosted web app only uses basic Google sign-in (openid, email, profile). All Gmail access happens in each user's own Apps Script, under their own Google account.
- **Least privilege tokens.** Engine connector tokens and MCP tokens are random, stored hashed (SHA-256), scoped, revocable, and show when they were last used. MCP tokens can only _read_ and _propose_.
- **Human approval.** Anything proposed through the web or MCP is applied only after the user approves it. MCP can never approve, delete, or switch production on.
- **No email bodies stored.** Audit events keep the sender domain, label and action by default. Subjects are opt-in.
- **Server-only writes.** Firestore security rules deny all client writes; users can read only their own documents.

## Supported versions

Only the latest release of the web app and the latest published engine library version receive fixes.
