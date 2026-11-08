# Self-hosting the MailOps dashboard

You need a free **Firebase** project and a free **Vercel** account. Allow about 15 minutes. You'll handle two secrets along the way, the service-account JSON and your Vercel env vars. Never commit them or share them.

## 1. Firebase project (mostly CLI)

From the repo's `firebase/` folder (the CLI is a dev dependency, so no global install is needed):

```bash
cd firebase
corepack pnpm exec firebase login                                   # opens your browser once
corepack pnpm exec firebase projects:create mailops-<suffix> --display-name "MailOps"
corepack pnpm exec firebase apps:create web "MailOps Web" --project mailops-<suffix>
corepack pnpm exec firebase apps:sdkconfig web <appId> --project mailops-<suffix>   # the 4 public config values
corepack pnpm exec firebase deploy --only firestore --project mailops-<suffix>      # enables the Firestore API, deploys rules + indexes
corepack pnpm exec firebase firestore:databases:create "(default)" --location asia-south1 --project mailops-<suffix>
corepack pnpm exec firebase deploy --only firestore --project mailops-<suffix>      # again, now that the database exists
```

A brand-new project can return 403 for a minute or two while its APIs and permissions propagate. Just retry.

The CLI can't do these two; use the console:

1. **Google sign-in:** _Build → Authentication → Get started → Sign-in method → Google → Enable_, and pick a support email.
2. **Service account (server secret):** _Project settings → Service accounts → Generate new private key._ Keep the downloaded JSON private.

## 2. Vercel

1. Sign in at <https://vercel.com> with GitHub → **Add New → Project** → import your fork of `mailops`.
2. **Root Directory:** `apps/web`. The framework (Next.js) and pnpm are detected automatically.
3. **Environment Variables** (see [`apps/web/.env.example`](../apps/web/.env.example)):

   | Name                               | Value                                                         |
   | ---------------------------------- | ------------------------------------------------------------- |
   | `NEXT_PUBLIC_FIREBASE_API_KEY`     | from `apps:sdkconfig` (step 1)                                |
   | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | from `apps:sdkconfig` (step 1)                                |
   | `NEXT_PUBLIC_FIREBASE_PROJECT_ID`  | from `apps:sdkconfig` (step 1)                                |
   | `NEXT_PUBLIC_FIREBASE_APP_ID`      | from `apps:sdkconfig` (step 1)                                |
   | `FIREBASE_SERVICE_ACCOUNT_JSON`    | the whole service-account JSON, pasted as one value           |
   | `ALLOWED_EMAILS`                   | your Google email(s), comma-separated. Only these can sign in |

4. **Deploy.** You get a URL like `https://mailops-xxxx.vercel.app`.

## 3. Allow sign-in from your Vercel domain

Firebase console → _Authentication → Settings → Authorized domains → Add domain_ → your `*.vercel.app` domain (without `https://`).

## 4. First sign-in

Open your Vercel URL → **Sign in with Google** → **Rules** → import your rules JSON once. After that, changes are proposals you approve.

The engine (Apps Script) connects in milestone M3; until then the Overview shows _Engine: Not connected_.
