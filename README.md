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

---

## Step 2: chat, admin dashboard, Instagram + Facebook insights

### What to try
1. **Admin → Chats**: open "Media Team" and tick people to add them. The "+ Sales"-style buttons add a whole department at once. You can also create new groups here or from **Chat → + Group**.
2. **Chat**: send a message with `@username`. The person gets a red **@** badge and a count on the Chat tab. Use **+ Message** to start a private DM.
3. **Request comments**: open any request and scroll to **Comments**. Media team members can tick **🔒 Internal note**, which the requester never sees. If the media team @mentions someone in a request thread, that person gets access to the request.
4. **Admin → Activity**: every status change, assignment, permission change, account change and group change is logged here.
5. **New request form**: Department is now a free-text box, with the department list offered as suggestions.

### Connecting Instagram + Facebook (one time, about 15 minutes)

You need these first:
- The Picklr Live Oak Instagram set up as a **Business or Creator** account, linked to the club's **Facebook Page**.
- Admin access to that Facebook Page.

1. **Create a Meta app.** Go to https://developers.facebook.com/apps and choose **Create app**.
   - Name: `Picklr Media Hub`
   - Use case: **Other**, then type **Business**
   - Leave it in **Development** mode. App Review isn't needed when only you use it.
2. **Add the Instagram product.** In the app, add **Instagram → API setup with Facebook login**.
3. **Copy the app's ID and secret.** Go to **App settings → Basic** and copy the **App ID** and **App Secret**.
4. **Store them in Supabase.** In the Supabase dashboard, go to **Edge Functions → Secrets → Add new secret** and add both:
   - `META_APP_ID` = your App ID
   - `META_APP_SECRET` = your App Secret (keep this one private)
5. **Connect from Media Hub.** Open **Media Hub → Insights → Connect** and follow the 3 steps on screen: open the Graph API Explorer, add the permissions, generate a token, paste it, and click **Connect**.
   - The permissions are `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `read_insights`, `instagram_basic`, `instagram_manage_insights`, `business_management`, `ads_read` and `ads_management`.
   - The last two are required when the Page is shared to you through Business Manager instead of owned by you. The app only reads; it never changes or spends anything on ads.
   - Your access to the Page and the Instagram account must include **Insights**.
   - The first sync runs straight away.
   - After that it syncs every night at 2:15 AM, and you can press **Sync now** at any time.

The token is stored in a locked part of the database that the website can't read. Only the sync function can use it.

**Every 90 days: reconnect.** Meta's own rules stop an app's "data access" 90 days after you last approved it. Media Hub checks the token every night and shows an amber warning on **Insights** and **Admin → Overview** 14 days before that date (and red if it ever stops working). To renew it, open the Graph API Explorer (User Token, same 9 permissions), click **Generate Access Token**, and paste it into **Insights → Settings → Connect**. You can also click **Check token** at any time.

**What's pulled:**
- Instagram: followers, plus views, reach, likes, comments, shares, saves, reposts and total interactions for each of your last 50 posts.
- Facebook: followers, plus views, reach, reactions, comments and shares for each of your last 50 posts.
- Daily account reach and views for both.

**Report:** go to **Insights → 📄 Report**, pick a date range, then **Print / Save as PDF** or **Copy summary**.

---

## Step 3: workflow, calendar, General chat, setup

### How a request flows
1. **Someone submits a request.** Everyone with the **Strategy team** toggle gets a notification, and it shows in their **Strategy queue** on Home.
2. **Strategy edits the details**, writes the brief/script, attaches files or Drive links, then taps **✓ Approve → Execution**.
3. **The Execution team** (you) gets notified and sees it under **Ready to produce** on Home. On the request, tap **📅 Schedule** to book the shoot and choose who's filming with you. Each person you add is notified.
4. The requester is notified at every status change.

### What to try
- **Calendar tab**: month, week and agenda views, filterable by type and person. It shows shoots, posts, meetings and events, plus every request's **due date**, **submitted date** and **event date**.
- **Admin → Access**: one grid for who can open **Insights**, who sees **everyone's calendar** vs only their own, who's on the **Strategy** and **Execution** teams, and Board/Chat access.
- **Admin → Setup**: add, rename, recolor, reorder or remove **content pillars** and **request categories**. Removing hides an item from pickers; old items keep their label. Use **Show removed → Restore** to bring one back.
- **Chat → 📌 General**: everyone is in it automatically, including people you add later. Create other groups the same way as before.
- **🔔 Notifications** (top right): new requests, approvals, status changes, schedule invites and @mentions.

## Step 4: access levels and posting goals

### Access levels (Admin → Access)
Pick a level for each person; their switches reset to that level's defaults, then tick any extras.

| Level | Sees |
|---|---|
| Admin | Everything, plus the Admin page |
| Manager | Everything (every request, everyone's calendar, insights), view-only by default |
| Media Strategy | Requests in the Strategy stage (New, In Strategy) + their own; their own calendar |
| Media Execution | Requests in the Execution stage (Ready for Execution → Posted) + their own; their own calendar |
| Department Lead | Their department's requests |
| Team member (default) | Only the requests, calendar items and progress tied to them |

A request's stage follows its status, so moving a card to "Ready for Execution" (or approving it) hands it from Strategy to Execution.

### Posting goals (Admin → Setup)
Add goals like "3 Reels per week" or "20 Stories per month". Insights and the report track each week/month against them. Stories count from Instagram only; the sync now runs every 6 hours so each story is caught while it's live.

## Step 5: phone push notifications

Each person turns them on once per device: **Me → 🔔 Turn on notifications**, then **Send a test**.

- **iPhone:** Safari → Share → *Add to Home Screen*, open Media Hub from that icon (iOS 16.4+), then turn them on. Safari tabs can't get notifications.
- **Android / computers:** works in Chrome, Edge or Firefox; installing the app is optional.
- **What gets sent:** chat messages (DMs/groups, General, request comments), @mentions, status changes on your requests, being scheduled, and new/approved requests for the Strategy/Execution teams.
- **Choosing:** everyone picks what they get on their Me page; the admin can change anyone's on Admin → People. The 🔔 bell in the app always shows everything.
- **How it works:** database triggers call the `push-send` Edge Function (Web Push with VAPID keys, free, no email). The private key is the `VAPID_KEYS` Supabase secret; the public key is in `src/lib/push.ts`.

## Step 6: Claude as your assistant (connector)

Talk to Claude in the Claude app (phone, desktop or claude.ai) and it can work in Media Hub for you: review requests, draft hooks/scripts into the brief, move requests between pillars/statuses, approve to Execution, assign people, schedule shoots, read and send chats, and summarize Instagram/Facebook.

**Connect (once):** Claude → Settings → Connectors → *Add custom connector* → name `Picklr Media Hub`, URL:
```
https://dkfimkjsolqhxtuqxdew.supabase.co/functions/v1/mcp
```
Click Connect → Media Hub opens → sign in → **Approve**.

- Claude acts **as you** (your permissions). Chats it sends show "via Claude". Say "as the Claude account" and it uses the separate **Claude** team member instead (admin only).
- Every change Claude makes is in **Admin → Activity** (source: Claude).
- Who can connect: admins, plus anyone with **Use Claude as an assistant** ticked in Admin → People.
- Under the hood: Supabase Auth's OAuth 2.1 server (Authentication → OAuth Server, approval page `oauth-consent.html`) and the `mcp` Edge Function. The Claude account's password is the `CLAUDE_ACCOUNT_PASSWORD` secret.

### Scheduled briefings
A Claude desktop scheduled task ("Picklr Media Hub briefing", 7am / 11am / 3pm / 6pm) calls the connector's `whats_new` tool, reads new requests and chats, and DMs a "📋" briefing to **newnehemiah** from the Claude account (which pushes to the phone). It only runs while the Claude desktop app is open on Nehemiah's Mac; a missed run happens at next launch. Edit or pause it under **Scheduled** in the Claude app sidebar.

## Library (scripts, hooks, shot lists, captions, templates)
The **📚 Library** tab is the media team's shared shelf for video scripts and reusable text. Search and filter by kind/pillar, pin favorites, archive old ones, link a doc to a request, copy text, or add a doc to a request's brief. Every edit keeps the previous version (View / Restore). On a request, **📚 Save to Library** saves its brief as a new doc. Access: `section.library` (open/read) and `library.edit` (add/edit): media teams and admin by default, managers read-only, team members none. Claude can use it through the connector (`list_library`, `get_library_doc`, `save_library_doc`).
