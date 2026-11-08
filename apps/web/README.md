# apps/web

Next.js dashboard and API, deployed on Vercel.

One signed-in user can manage **several mailboxes** (Gmail addresses), each with its own rules and settings. Switch between them in the header.

| Route                                        | What                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/`                                          | Sign in with Google (Firebase Auth)                                                                                    |
| `/dashboard`                                 | Overview of the selected mailbox (engine status, mode, rules, pending proposals, guards) + all mailboxes + add mailbox |
| `/rules`                                     | Rules of the selected mailbox; one-time JSON import; "Propose change" creates a pending proposal                       |
| `GET /api/web/me`                            | Profile + mailbox summaries                                                                                            |
| `POST /api/web/mailboxes`                    | Add a mailbox `{ email, displayName? }` (409 if already added; max 20)                                                 |
| `GET /api/web/mailboxes/{id}/rules`          | The mailbox's rules                                                                                                    |
| `POST /api/web/mailboxes/{id}/rules/import`  | One-time seed (409 if the mailbox already has rules)                                                                   |
| `GET/POST /api/web/mailboxes/{id}/proposals` | Pending proposals / create one (validated by `@mailops/schema`)                                                        |

Every API call verifies the Firebase ID token and checks `ALLOWED_EMAILS` (invite-only). Mailbox routes return 404 for mailboxes the caller doesn't own. All Firestore writes happen on the server with the Admin SDK.

```bash
cp .env.example .env.local   # fill in values (see docs/self-hosting.md)
corepack pnpm dev            # http://localhost:3000 (localhost is an authorized domain by default)
```
