# Self-hosting the MailOps dashboard

You need a free **Firebase** project and a free **Vercel** account. Allow about 15 minutes. You'll handle two secrets along the way, the service-account JSON and your Vercel env vars. Never commit them or share them.

## 1. Firebase project

1. Go to <https://console.firebase.google.com> → **Create a project**. The Spark (free) plan is enough; Google Analytics is optional.
2. **Firestore:** _Build → Firestore Database → Create database_ → **production mode** → choose a location near you (it can't be changed later).
3. **Google sign-in:** _Build → Authentication → Get started → Sign-in method → Google → Enable_, and pick a support email.
4. **Web app config:** _Project settings (⚙) → General → Your apps → Web (`</>`)_, register an app (no Hosting needed), and copy `apiKey`, `authDomain`, `projectId` and `appId`.
5. **Service account (server secret):** _Project settings → Service accounts → Generate new private key._ Keep the downloaded JSON private.
6. **Deploy the security rules and indexes** from this repo. The `firebase login` step opens your browser:
   ```bash
   cd firebase
   corepack pnpm exec firebase login
   corepack pnpm exec firebase deploy --only firestore --project <your-project-id>
   ```

## 2. Vercel

1. Sign in at <https://vercel.com> with GitHub → **Add New → Project** → import your fork of `mailops`.
2. **Root Directory:** `apps/web`. The framework (Next.js) and pnpm are detected automatically.
3. **Environment Variables** (see [`apps/web/.env.example`](../apps/web/.env.example)):

   | Name                               | Value                                                         |
   | ---------------------------------- | ------------------------------------------------------------- |
   | `NEXT_PUBLIC_FIREBASE_API_KEY`     | from step 1.4                                                 |
   | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | from step 1.4                                                 |
   | `NEXT_PUBLIC_FIREBASE_PROJECT_ID`  | from step 1.4                                                 |
   | `NEXT_PUBLIC_FIREBASE_APP_ID`      | from step 1.4                                                 |
   | `FIREBASE_SERVICE_ACCOUNT_JSON`    | the whole JSON from step 1.5, pasted as one value             |
   | `ALLOWED_EMAILS`                   | your Google email(s), comma-separated. Only these can sign in |

4. **Deploy.** You get a URL like `https://mailops-xxxx.vercel.app`.

## 3. Allow sign-in from your Vercel domain

Firebase console → _Authentication → Settings → Authorized domains → Add domain_ → your `*.vercel.app` domain (without `https://`).

## 4. First sign-in

Open your Vercel URL → **Sign in with Google** → **Rules** → import your rules JSON once. After that, changes are proposals you approve.

The engine (Apps Script) connects in milestone M3; until then the Overview shows _Engine: Not connected_.
