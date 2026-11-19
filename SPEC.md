# Picklr Media Hub: Spec (v1)

An internal tool for the Media department at The Picklr Live Oak. Fewer than 12 users. Timezone: **America/Chicago** (San Antonio).

## 1. Stack

| Piece | Choice | Cost |
|---|---|---|
| Frontend | Vite + React + TypeScript + Tailwind, hash routing (`/#/board`) | Free |
| Hosting | Public GitHub repo, GitHub Actions deploys to GitHub Pages | Free |
| App install | PWA (manifest, icons, service worker), "Add to Home Screen" | Free |
| Database, auth, files, chat | Supabase: Postgres + Auth + Storage + Realtime, with RLS on every table | Free plan |
| Server code | Supabase Edge Functions: `admin-users`, `notify` (push), `ics`, `mcp`, and later `ig-sync` | Free plan |
| Push notifications | Web Push (VAPID keys), sent from the `notify` function | Free |
| Scheduling | `pg_cron` (nightly Instagram sync) | Free plan |

**Secrets.** The frontend only holds the Supabase URL and the public anon key. The service role key, VAPID private key and Instagram token are stored as Supabase secrets or in Supabase Vault. They never go in the repo.

**Free-plan limits.** Supabase pauses a project after about 7 days with no use, and one click restores it. Storage is capped at 1 GB, so uploads are limited to images and PDFs of 10 MB or less, and images are compressed in the browser before upload. Video is stored as Google Drive links only.

## 2. Login & accounts

- **Username + password.** There are no emails and public sign-up is turned off.
- You (Admin) create every account on the Team page. Behind the scenes the `admin-users` Edge Function creates the Supabase user. It checks that the caller has `team.manage` before doing anything.
- Supabase needs an email address for each user, so each login gets a placeholder internal address such as `jdoe@staff.picklr.local`. Staff only ever type their username. The profile also has a separate, optional real contact email.
- The Admin can reset a password or deactivate a user. Users can change their own password.

## 3. Roles & toggleable permissions

A **role is just a preset.** Choosing a role fills in a default set of permission toggles, and you can then switch any of them on or off per person on the Team page. RLS checks the individual permissions, never the role name.

| Permission key | What it allows | Admin | Strategy | Execution | Dept Lead | Staff | Claude |
|---|---|---|---|---|---|---|---|
| `section.requests` | See Requests (New + Mine) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `section.board` | See Board | ✅ | ✅ | ✅ | ⬜ | ⬜ | ✅ |
| `section.calendar` | See Calendar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `section.chat` | See Chat | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `section.insights` | See Insights | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| `requests.view_dept` | See all requests from their department | ✅ | ✅ | ✅ | ✅ | ⬜ | ✅ |
| `requests.view_all` | See every request | ✅ | ✅ | ✅ | ⬜ | ⬜ | ✅ |
| `requests.manage` | Change status, assignees, pillar, priority, brief/script, asset links | ✅ | ✅ | ✅ | ⬜ | ⬜ | ✅ |
| `requests.internal` | See and write internal-only comments | ✅ | ✅ | ✅ | ⬜ | ⬜ | ✅ |
| `calendar.edit` | Create and edit calendar items | ✅ | ✅ | ✅ | ⬜ | ⬜ | ✅ |
| `chat.create_groups` | Create group chats | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| `insights.manage` | CSV upload, Instagram connection | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| `team.manage` | Team page and audit log | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | 🔒 never |

These rules apply no matter how the toggles are set:
- Everyone can create requests and always sees their own.
- Requesters can edit details and uploads only while their request is **New**, and can comment at any time.
- Delete is Admin-only.
- The Claude account can never get `team.manage` or any delete rights, and the database enforces this.

## 4. Database tables

All timestamps are `timestamptz`. Every table has RLS enabled.

| Table | Key columns |
|---|---|
| `departments` | id, name (8 seeded: Management, Events & Leagues, Sales, Programs & Academy, Operations, Front Desk, Media (Strategy), Media (Execution)) |
| `profiles` | id (= auth user), username, full_name, role, department_id, phone, contact_email, avatar_path, permissions `text[]`, is_service_account, active, ics_token |
| `requests` | id, number (#101…), title, requester_id, department_id, type (Video/Reel/Graphic/Story/Livestream/Ad/Photo/Other), event_name, event_date, needed_by, details, status (New/In Strategy/Ready for Execution/In Production/Scheduled/Posted/On Hold), section (Strategy/Execution), pillar, priority (Low/Normal/High/Urgent), brief (text), drive_links `jsonb` ([{label,url}]), created_at, updated_at |
| `request_assignees` | request_id, user_id |
| `request_files` | id, request_id, storage_path, file_name, mime, size_bytes, uploaded_by |
| `chats` | id, kind (dm / group / request), name, department_id?, request_id? (one thread per request) |
| `chat_members` | chat_id, user_id, last_read_at (drives unread badges) |
| `messages` | id, chat_id, author_id, body, mentions `uuid[]`, attachment_path?, link_url?, internal (bool, request threads only), created_at |
| `calendar_items` | id, type (Shoot/Club Event/Post/Livestream/Meeting/Deadline), title, starts_at, ends_at, all_day, location, notes, request_id?, platform?, caption_draft?, post_status? (Draft/Ready/Scheduled/Posted), created_by |
| `calendar_assignees` | item_id, user_id |
| `push_subscriptions` | id, user_id, endpoint, p256dh, auth, created_at |
| `notification_prefs` | user_id, mentions, dms, new_requests, my_request_status (all on/off) |
| `audit_log` | id, at, actor_id, source ('mcp' / 'app'), tool, args `jsonb`, ok, error |
| `ig_daily` (step 5) | date, followers, source ('instagram' / 'soci') |
| `ig_posts` (step 5) | id, permalink, posted_at, media_type, caption, pillar?, request_id?, reach, views, likes, comments, shares, saves, source, synced_at |

**Storage:** one private bucket called `uploads`. Its file size limit is 10 MB and it only accepts images and PDFs. Paths look like `requests/<id>/…`, `chat/<chat_id>/…` and `avatars/<user_id>/…`, and storage policies reuse the same visibility rules as the tables.

**Realtime:** turned on for `messages`, `requests` and `calendar_items`.

## 5. Pages (mobile-first, bottom tab bar)

| Page | What's on it |
|---|---|
| **Login** | Username + password |
| **Home** | My open requests and their status, my upcoming calendar items, unread mentions |
| **New Request** | Short form: requester (defaults to me), dept, type, event/program, event date, needed-by, details, uploads, Drive links |
| **Board** | Kanban (swipe columns on phone) and list view, with filters for status, pillar, assignee, dept, type |
| **Request detail** | Every field, the brief/script editor, assignees, files and links, and its comment thread (internal toggle) |
| **Chat** | List of DMs, groups and request threads with unread badges. Thread view with @mention autocomplete and image attach |
| **Calendar** | Month / week / agenda views, with filters by type and person. Post items show platform, caption and status |
| **Team** (Admin) | Add users (username + temp password), role preset, dept, permission toggles, deactivate, reset password |
| **Audit log** (Admin) | Every Claude tool call with arguments and result |
| **Insights** (step 5) | Follower trend, top posts, by pillar, posts per week vs. target (3 Reels + 2 graphics) |
| **Me** | Profile and photo, change password, enable push, copy my ICS calendar link |

**Brand:** black `#0B0B0C`, electric blue `#0075E7`, cream `#F8F2E6`, Anton for headlines, Montserrat for body text. The logo is a placeholder "PMH" mark until you send a Picklr logo file.

## 6. Push notifications

- Each person taps **Enable notifications** on the Me page. On iPhone this only works after the app has been added to the Home Screen, on iOS 16.4 or later. Android works from Chrome directly.
- Database webhooks call the `notify` Edge Function, which sends a push for these events:
  - you were @mentioned
  - you got a new DM
  - a new request arrived (for people with `requests.view_all`)
  - your request's status changed
- **Notification settings:** every user can turn each event on or off for themselves on the **Me** page. The Admin can also see and change anyone's notification settings from the Team page. RLS enforces this: you can edit your own row, and `team.manage` can edit any row.
- Push only fires if the person's setting for that event is on and they have enabled push on at least one device.

## 7. ICS feed

`https://<project>.supabase.co/functions/v1/ics?token=<personal secret>` returns the calendar items you're allowed to see. You subscribe to it once from Google Calendar, and a new token can be issued if a link leaks.

## 8. Claude connector (MCP)

- A Supabase Edge Function `mcp` that speaks the Streamable HTTP transport and is built with the official MCP TypeScript SDK.
- **Auth:** OAuth 2.1 per the current MCP authorization spec, using Supabase Auth's built-in OAuth 2.1 server if the current docs confirm it fits. I'll check them when we reach that step. You sign in once as the **Claude** service account. Each tool then runs with Claude's own token, so **RLS limits Claude exactly like a Strategy user**.
- **Tools:** `list_requests`, `get_request`, `create_request`, `update_request` (status, assignees, brief/script, pillar, priority, section, links; no delete), `list_chats`, `read_chat`, `post_message`, `list_calendar`, `create_calendar_item`, `update_calendar_item`, `get_team_directory`.
- There are no delete tools and no permission or team tools. Every call is written to `audit_log`.
- Claude can only see chats it is a member of: group chats, request threads, and DMs with Claude. It never sees other people's DMs.

## 9. Build order

Each step is built, deployed, seeded with test data, RLS-tested (signed in as different test users), and committed with a "what to try" note.

1. Login, Team page, permissions, request form, board, request detail, PWA shell
2. Chat (realtime, mentions, attachments, unread) + push notifications
3. Calendar + ICS feed
4. Claude MCP connector + audit log
5. Insights (CSV import first, then the Instagram Graph API nightly sync)

## 10. Setup you'll do (I'll walk you through each when we get there)

1. Create a free Supabase project and give me the project URL and anon key (both are safe to share). You'll also log in with the Supabase CLI on your Mac.
2. Create the GitHub repo and turn on Pages (source: GitHub Actions).
3. Add 2 repo variables (Supabase URL and anon key).
4. Generate VAPID keys and store them as Supabase secrets (step 2).
5. Add the connector in Claude settings with the `mcp` function URL (step 4).
6. Create the Meta developer app and connect Instagram (step 5).
