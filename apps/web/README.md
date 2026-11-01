# apps/web

Next.js dashboard and API, deployed on Vercel.

| Route                         | What                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `/`                           | Sign in with Google (Firebase Auth)                                            |
| `/dashboard`                  | Overview: engine status, mode, rule count, pending proposals, safety guards    |
| `/rules`                      | Rules table; one-time JSON import; "Propose change" creates a pending proposal |
| `GET /api/web/me`             | Profile + settings (created with safe defaults on first sign-in)               |
| `GET /api/web/rules`          | The user's rules                                                               |
| `POST /api/web/rules/import`  | One-time seed (409 if rules already exist)                                     |
| `GET/POST /api/web/proposals` | Pending proposals / create one (validated by `@mailops/schema`)                |

Every API call verifies the Firebase ID token and checks `ALLOWED_EMAILS` (invite-only). All Firestore writes happen on the server with the Admin SDK.

```bash
cp .env.example .env.local   # fill in values (see docs/self-hosting.md)
corepack pnpm dev            # http://localhost:3000 (add localhost to Firebase authorized domains)
```
