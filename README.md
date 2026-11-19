# Picklr Media Hub

Internal tool for the Media department at The Picklr Live Oak: media requests, a production board, chat, a calendar, and a Claude connector. See [SPEC.md](SPEC.md) for the full design.

**Stack:** Vite + React + TypeScript + Tailwind (static site on GitHub Pages) and Supabase (database, login, file storage, realtime, Edge Functions). Everything runs on free plans.

## Project layout

```
src/
  pages/          one file per screen (Board, NewRequest, RequestDetail, Team, Me…)
  components/     shared UI pieces
  lib/            Supabase client, auth/permissions context, constants, uploads
  sw.ts           service worker (offline shell; push notifications later)
supabase/
  migrations/     database schema + RLS permission rules (run in order)
  functions/      Edge Functions (server code that holds secrets)
tests/rls.test.mjs   permission tests (runs the real migrations in an in-memory Postgres)
scripts/seed.mjs     create your admin account / test users
```

## Everyday commands

```bash
npm run dev          # local site at http://localhost:5173
npm run test:rls     # check database permissions
npx supabase db push # apply new migrations to the live database
npx supabase functions deploy admin-users
```

---

## One-time setup (step 1)

### A. Supabase project (about 10 minutes)

1. Go to **supabase.com**, sign in with GitHub, and create a **New project**.
   - Name: `picklr-media-hub`
   - Database password: generate one and **save it in your password manager**. You need it in step B2.
   - Region: any US region near Texas (Central or East).
   - Plan: **Free**.
2. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". Only you create accounts, from the Team page.
3. **Project Settings → API Keys**. You need three values:
   - **Project URL**, like `https://abcd1234.supabase.co`. Public.
   - **anon / publishable key**. Public, safe in the browser.
   - **service_role / secret key**. **SECRET.** It only ever goes in `.env.local` on your Mac.
4. In the project folder, open `.env.local` and fill in all three:
   ```
   VITE_SUPABASE_URL=https://abcd1234.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...   (anon / publishable)
   SUPABASE_SERVICE_ROLE_KEY=eyJ...   (service_role / secret)
   ```
   `.env.local` is in `.gitignore`, so it is never uploaded.

### B. Put the database and server code into Supabase

Run these in Terminal from the project folder:

1. Log the CLI in to your Supabase account. This opens your browser.
   ```bash
   npx supabase login
   ```
2. Connect this folder to your project. Your project ref is the `abcd1234` part of the URL. It will ask for the database password from A1.
   ```bash
   npx supabase link --project-ref abcd1234
   ```
3. Create all the tables and permission rules.
   ```bash
   npx supabase db push
   ```
4. Deploy the account-management function.
   ```bash
   npx supabase functions deploy admin-users
   ```
5. Create **your** admin account. It asks for your name, username and password.
   ```bash
   node scripts/seed.mjs admin
   ```
6. Optional: create 5 test users and 7 sample requests. Their logins are saved to `test-accounts.local.txt`.
   ```bash
   node scripts/seed.mjs test
   ```
7. Start the site locally and sign in at http://localhost:5173.
   ```bash
   npm run dev
   ```

### C. Publish to GitHub Pages

1. On github.com, create a **new public repository** named `picklr-media-hub`. Leave it empty: no README and no .gitignore.
2. Push this folder to it:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/picklr-media-hub.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.
4. Go to **Settings → Secrets and variables → Actions → Variables tab → New repository variable** and add both:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon / publishable key
5. Go to **Actions → Deploy to GitHub Pages → Run workflow**, or push any commit. After about a minute the site is live at `https://YOUR-USERNAME.github.io/picklr-media-hub/`.

**Never** put the service_role / secret key in GitHub. The site only needs the two public values.

### Free-plan notes
- Supabase pauses a free project after ~7 days with no activity. If that happens, open the dashboard and click **Restore**. No data is lost.
- Storage is 1 GB in total. Images are compressed on upload and files are capped at 10 MB. Video goes in Google Drive links only.

---

## What to try after step 1

1. Sign in as yourself, open **Team**, and add a real teammate. Pick a role, then flip a few toggles.
2. Sign in on your phone, then use **Me → Put it on your phone** to install the app.
3. Submit a request from your phone with a photo attached. Check that it shows on the **Board** under *New*.
4. On a computer, drag a card to another column. On a phone, open the card and change its status.
5. In a private window, sign in as `test.staff` (logins are in `test-accounts.local.txt`). They should only see their own request and no Board tab. Try editing a request that is no longer *New*: the fields are locked.
6. Sign in as `test.lead`. They should see all Sales requests but not the Front Desk one.
7. On the Team page, turn off **Board** for `test.strategy`. Sign in as them and the tab is gone.
8. When you're done: `node scripts/seed.mjs remove-test`
