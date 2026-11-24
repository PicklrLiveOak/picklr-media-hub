// RLS permission tests — run with:  npm run test:rls
//
// Loads every file in supabase/migrations into an in-memory Postgres (PGlite),
// with small stand-ins for Supabase's auth/storage schemas, then acts as
// different users to prove who can see and change what.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const db = new PGlite();

// ---- Minimal Supabase stand-ins ------------------------------------------
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public bool,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner_id text default auth.uid()::text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, delete on storage.objects to authenticated;
  create publication supabase_realtime;
  grant usage on schema public to authenticated, anon;
`);

const dir = 'supabase/migrations';
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.includes('_cron')).sort()) {
  await db.exec(readFileSync(join(dir, f), 'utf8'));
}

// ---- Test people -----------------------------------------------------------
const U = {
  admin:    '00000000-0000-0000-0000-000000000001',
  strategy: '00000000-0000-0000-0000-000000000002',
  exec:     '00000000-0000-0000-0000-000000000003',
  lead:     '00000000-0000-0000-0000-000000000004', // Sales lead
  staff:    '00000000-0000-0000-0000-000000000005', // Sales staff
  staff2:   '00000000-0000-0000-0000-000000000006', // Front Desk staff
  claude:   '00000000-0000-0000-0000-000000000007',
  manager:  '00000000-0000-0000-0000-000000000008',
};
const dept = async (n) => (await db.query('select id from departments where name=$1', [n])).rows[0].id;
const SALES = await dept('Sales'), FRONT = await dept('Front Desk');

for (const [name, id] of Object.entries(U)) {
  const role = { exec: 'execution', staff2: 'staff' }[name] ?? name;
  const d = ['lead', 'staff'].includes(name) ? SALES : name === 'staff2' ? FRONT : null;
  await db.query('insert into auth.users values ($1, $2)', [id, `${name}@test`]);
  await db.query(
    `insert into profiles (id, username, full_name, role, department_id, permissions, is_service_account)
     select $1, $2, $2, $3, $4, permissions, $3 = 'claude' from role_presets where role = $3`,
    [id, name, role, d]);
}

// Run SQL as a signed-in user. Returns rows, or throws Postgres errors.
async function as(user, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U[user]}', false); set role authenticated;`);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec('reset role'); }
}

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); passed++; console.log('  ✓', label); }
  catch (e) { failed++; console.log('  ✗', label, '\n     ', e.message); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
async function expectError(p, msg) {
  try { await p; } catch { return; }
  throw new Error(msg ?? 'expected an error, but it succeeded');
}

// ---- Seed requests ---------------------------------------------------------
const [r1] = await as('staff', `insert into requests (title, type, department_id, status)
  values ('Sales promo reel', 'Reel', $1, 'Posted') returning id, status, section`, [SALES]);
const [r2] = await as('staff2', `insert into requests (title, type, department_id)
  values ('Front desk sign', 'Graphic', $1) returning id`, [FRONT]);
const [r3] = await as('strategy', `insert into requests (title, type, status, requester_id)
  values ('League recap', 'Video', 'In Production', $1) returning id`, [U.strategy]);

console.log('\nRequests');
await check('non-manager insert is forced to status New', async () => {
  expect(r1.status === 'New' && r1.section === 'Strategy', `got ${r1.status}/${r1.section}`);
});
await check('staff sees only their own requests', async () => {
  const rows = await as('staff', 'select id from requests');
  expect(rows.length === 1 && rows[0].id === r1.id, `saw ${rows.length}`);
});
await check('dept lead sees their department, not others', async () => {
  const ids = (await as('lead', 'select id from requests')).map((r) => r.id);
  expect(ids.includes(r1.id) && !ids.includes(r2.id) && !ids.includes(r3.id), JSON.stringify(ids));
});
await check('Managers and Claude see everything', async () => {
  for (const u of ['manager', 'claude']) {
    const n = (await as(u, 'select id from requests')).length;
    expect(n === 3, `${u} saw ${n}`);
  }
});
await check('Strategy team sees Strategy-stage requests (+ their own)', async () => {
  const ids = (await as('strategy', 'select id from requests')).map((r) => r.id);
  expect(ids.length === 3 && ids.includes(r2.id), JSON.stringify(ids));
});
await check('Execution team does not see Strategy-stage requests', async () => {
  const ids = (await as('exec', 'select id from requests')).map((r) => r.id);
  expect(ids.length === 1 && ids[0] === r3.id, JSON.stringify(ids));
});
await check('Managers are view-only by default', async () => {
  const rows = await as('manager', `update requests set details='x' where id=$1 returning id`, [r2.id]);
  expect(rows.length === 0, 'manager edited a request');
});
await check('staff cannot create a request on behalf of someone else', () =>
  expectError(as('staff', `insert into requests (title, type, requester_id) values ('x','Reel',$1)`, [U.staff2])));
await check('staff can edit details while New', async () => {
  const rows = await as('staff', `update requests set details='more info' where id=$1 returning id`, [r1.id]);
  expect(rows.length === 1, 'update affected 0 rows');
});
await check('staff cannot change status', () =>
  expectError(as('staff', `update requests set status='Posted' where id=$1`, [r1.id])));
await check('staff cannot edit another person\'s request', async () => {
  const rows = await as('staff', `update requests set details='hack' where id=$1 returning id`, [r2.id]);
  expect(rows.length === 0, 'should not update');
});
await check('strategy can move status and write brief', async () => {
  const rows = await as('strategy', `update requests set status='In Strategy', brief='Hook: ...'
    where id=$1 returning status`, [r1.id]);
  expect(rows[0]?.status === 'In Strategy', 'no update');
});
await check('staff can no longer edit once it leaves New', async () => {
  const rows = await as('staff', `update requests set details='late' where id=$1 returning id`, [r1.id]);
  expect(rows.length === 0, 'should not update');
});
await check('Claude can update status', async () => {
  const rows = await as('claude', `update requests set status='Ready for Execution' where id=$1 returning id`, [r1.id]);
  expect(rows.length === 1, 'no update');
});
await check('moving to Execution hands it from Strategy to Execution', async () => {
  const s = (await as('strategy', 'select id from requests where id=$1', [r1.id])).length;
  const e = (await as('exec', 'select id from requests where id=$1', [r1.id])).length;
  expect(s === 0 && e === 1, `strategy ${s}, exec ${e}`);
});
await check('only admin can delete requests', async () => {
  for (const u of ['staff', 'strategy', 'claude']) {
    const rows = await as(u, 'delete from requests where id=$1 returning id', [r2.id]);
    expect(rows.length === 0, `${u} deleted!`);
  }
  const rows = await as('admin', 'delete from requests where id=$1 returning id', [r2.id]);
  expect(rows.length === 1, 'admin could not delete');
});

console.log('\nAssignees & files');
await check('staff cannot assign people', () =>
  expectError(as('staff', 'insert into request_assignees values ($1,$2)', [r1.id, U.staff])));
await check('strategy can assign execution', async () => {
  await as('strategy', 'insert into request_assignees values ($1,$2)', [r3.id, U.exec]);
});
await check('staff2 cannot see request files of others', async () => {
  await as('strategy', `insert into request_files (request_id, storage_path, file_name, mime, size_bytes)
    values ($1::uuid, 'requests/'||$1::text||'/a.jpg', 'a.jpg', 'image/jpeg', 1000)`, [r3.id]);
  const rows = await as('staff2', 'select * from request_files');
  expect(rows.length === 0, 'leak');
});
await check('files over 10 MB are rejected', () =>
  expectError(as('strategy', `insert into request_files (request_id, storage_path, file_name, mime, size_bytes)
    values ($1::uuid, 'requests/'||$1::text||'/big.pdf', 'big.pdf', 'application/pdf', 20000000)`, [r3.id])));
await check('videos cannot be uploaded (Drive links only)', () =>
  expectError(as('strategy', `insert into request_files (request_id, storage_path, file_name, mime, size_bytes)
    values ($1::uuid, 'requests/'||$1::text||'/v.mp4', 'v.mp4', 'video/mp4', 1000)`, [r3.id])));

console.log('\nStorage');
await check('staff can upload to their own New request folder', async () => {
  const [r] = await as('staff', `insert into requests (title, type) values ('Another','Photo') returning id`);
  await as('staff', `insert into storage.objects (bucket_id, name) values ('uploads', 'requests/'||$1::text||'/p.jpg')`, [r.id]);
});
await check('staff cannot upload into someone else\'s request', () =>
  expectError(as('staff2', `insert into storage.objects (bucket_id, name) values ('uploads', 'requests/'||$1::text||'/x.jpg')`, [r3.id])));
await check('you can only upload your own avatar', () =>
  expectError(as('staff', `insert into storage.objects (bucket_id, name) values ('uploads', 'avatars/${U.staff2}/me.jpg')`)));

console.log('\nTeam & permissions');
await check('staff can update their own phone', async () => {
  const rows = await as('staff', `update profiles set phone='210-555-0100' where id=$1 returning id`, [U.staff]);
  expect(rows.length === 1, 'no update');
});
await check('staff cannot give themselves permissions', () =>
  expectError(as('staff', `update profiles set permissions = permissions || '{requests.view_all}' where id=$1`, [U.staff])));
await check('staff cannot edit someone else\'s profile', async () => {
  const rows = await as('staff', `update profiles set phone='x' where id=$1 returning id`, [U.staff2]);
  expect(rows.length === 0, 'should not update');
});
await check('strategy cannot change permissions', async () => {
  const rows = await as('strategy', `update profiles set permissions='{}' where id=$1 returning id`, [U.staff]);
  expect(rows.length === 0, 'should not update');
});
await check('admin can toggle a staff member\'s permissions', async () => {
  const rows = await as('admin', `update profiles set permissions = permissions || '{section.board}'
    where id=$1 returning permissions`, [U.staff]);
  expect(rows[0]?.permissions.includes('section.board'), 'no change');
});
await check('admin cannot change their own role (no lock-out)', () =>
  expectError(as('admin', `update profiles set role='staff' where id=$1`, [U.admin])));
await check('Claude can never be given team.manage', () =>
  expectError(as('admin', `update profiles set permissions = permissions || '{team.manage}' where id=$1`, [U.claude])));
await check('turning a permission off actually removes access', async () => {
  await as('admin', `update profiles set permissions = array_remove(permissions, 'requests.view_dept') where id=$1`, [U.lead]);
  const n = (await as('lead', 'select id from requests')).length;
  expect(n === 0, `lead still sees ${n}`);
});
await check('deactivated users lose all permissions', async () => {
  await as('admin', 'update profiles set active=false where id=$1', [U.exec]);
  const n = (await as('exec', 'select id from requests')).length;
  expect(n === 0, `still sees ${n}`);
});

// ---------------------------------------------------------------------------
console.log('\nDepartment text box');
await check('department is filled from the requester profile automatically', async () => {
  const [r] = await as('staff', `insert into requests (title, type, department_label) values ('Dept test','Photo','Sales floor') returning department_id, department_label`);
  expect(r.department_id === SALES && r.department_label === 'Sales floor', JSON.stringify(r));
});

console.log('\nChat');
const [{ start_dm: dm }] = await as('staff', 'select start_dm($1)', [U.staff2]);
await check('a DM is private to its two people', async () => {
  await as('staff', `insert into messages (chat_id, body) values ($1, 'hey')`, [dm]);
  expect((await as('staff2', 'select * from messages where chat_id=$1', [dm])).length === 1, 'recipient cannot read');
  for (const u of ['admin', 'strategy', 'claude', 'lead']) {
    const n = (await as(u, 'select * from messages where chat_id=$1', [dm])).length;
    expect(n === 0, `${u} can read the DM`);
  }
});
await check('starting the same DM again reuses it', async () => {
  const [{ start_dm: again }] = await as('staff2', 'select start_dm($1)', [U.staff]);
  expect(again === dm, 'created a duplicate');
});
await check('nobody can post as someone else', () =>
  expectError(as('staff2', `insert into messages (chat_id, body, author_id) values ($1, 'fake', $2)`, [dm, U.staff])));
await check('staff cannot create group chats', () =>
  expectError(as('staff', `select create_group('Secret', array[$1]::uuid[])`, [U.staff2])));
const [{ create_group: grp }] = await as('admin', `select create_group('Media Team test', array[$1, $2]::uuid[])`, [U.strategy, U.staff]);
await check('group members can read and post; outsiders cannot', async () => {
  await as('staff', `insert into messages (chat_id, body, mentions) values ($1, 'hi @test', array[$2]::uuid[])`, [grp, U.strategy]);
  expect((await as('strategy', 'select * from messages where chat_id=$1', [grp])).length === 1, 'member cannot read');
  expect((await as('staff2', 'select * from messages where chat_id=$1', [grp])).length === 0, 'outsider can read');
  await expectError(as('staff2', `insert into messages (chat_id, body) values ($1, 'let me in')`, [grp]));
});
await check('unread count and @mention flag show in the chat list', async () => {
  const row = (await as('strategy', 'select * from chat_list() where id=$1', [grp]))[0];
  expect(row?.unread === 1 && row?.mentioned === true, JSON.stringify(row));
  await as('strategy', 'select mark_read($1)', [grp]);
  const after = (await as('strategy', 'select * from chat_list() where id=$1', [grp]))[0];
  expect(after.unread === 0 && after.mentioned === false, JSON.stringify(after));
});
await check('only the group manager can change members', async () => {
  await expectError(as('staff', 'select set_group_members($1, array[]::uuid[])', [grp]));
  await as('admin', 'select set_group_members($1, array[$2,$3]::uuid[])', [grp, U.admin, U.strategy]);
  expect((await as('staff', 'select * from messages where chat_id=$1', [grp])).length === 0, 'removed member still reads');
});
await check('turning off Chat hides chats', async () => {
  await as('admin', `update profiles set permissions = array_remove(permissions, 'section.chat') where id=$1`, [U.staff2]);
  expect((await as('staff2', 'select * from messages where chat_id=$1', [dm])).length === 0, 'still sees DM');
  await as('admin', `update profiles set permissions = permissions || '{section.chat}' where id=$1`, [U.staff2]);
});

console.log('\nRequest threads');
const [rq] = await as('staff', `insert into requests (title, type) values ('Thread test','Reel') returning id`);
const [{ request_chat: thread }] = await as('staff', 'select request_chat($1)', [rq.id]);
await check('requester and media team share the thread', async () => {
  await as('staff', `insert into messages (chat_id, body) values ($1, 'Need it Friday')`, [thread]);
  expect((await as('strategy', 'select * from messages where chat_id=$1', [thread])).length === 1, 'strategy cannot read');
  expect((await as('staff2', 'select * from messages where chat_id=$1', [thread])).length === 0, 'outsider reads thread');
});
await check('internal notes are hidden from the requester', async () => {
  await as('strategy', `insert into messages (chat_id, body, internal) values ($1, 'budget is tight', true)`, [thread]);
  const seen = await as('staff', 'select body from messages where chat_id=$1', [thread]);
  expect(seen.length === 1 && seen[0].body === 'Need it Friday', JSON.stringify(seen));
  await expectError(as('staff', `insert into messages (chat_id, body, internal) values ($1, 'sneaky', true)`, [thread]));
});
await check('media team @mention loops someone into the request', async () => {
  expect((await as('staff2', 'select id from requests where id=$1', [rq.id])).length === 0, 'already visible');
  await as('strategy', `insert into messages (chat_id, body, mentions) values ($1, 'cc', array[$2]::uuid[])`, [thread, U.staff2]);
  expect((await as('staff2', 'select id from requests where id=$1', [rq.id])).length === 1, 'not looped in');
  expect((await as('staff2', 'select * from messages where chat_id=$1', [thread])).length === 2, 'should see 2 non-internal');
});
await check('staff @mention does NOT grant access', async () => {
  const [r2] = await as('staff', `insert into requests (title, type) values ('Private','Photo') returning id`);
  const [{ request_chat: t2 }] = await as('staff', 'select request_chat($1)', [r2.id]);
  await as('staff', `insert into messages (chat_id, body, mentions) values ($1, 'hey', array[$2]::uuid[])`, [t2, U.lead]);
  expect((await as('lead', 'select id from requests where id=$1', [r2.id])).length === 0, 'lead got access');
});
await check('chat uploads follow chat access', async () => {
  await as('staff', `insert into storage.objects (bucket_id, name) values ('uploads', 'chat/'||$1::text||'/a.jpg')`, [dm]);
  await expectError(as('lead', `insert into storage.objects (bucket_id, name) values ('uploads', 'chat/'||$1::text||'/b.jpg')`, [dm]));
});

console.log('\nActivity log');
await check('changes are logged and only the admin can read the log', async () => {
  await as('strategy', `update requests set status='In Strategy' where id=$1`, [rq.id]);
  const rows = await as('admin', `select action, summary from activity_log where action='request.status' order by id desc limit 1`);
  expect(rows[0]?.summary.includes('New → In Strategy'), JSON.stringify(rows));
  expect((await as('strategy', 'select * from activity_log')).length === 0, 'strategy can read log');
});
await check('nobody can write or erase the log directly', async () => {
  await expectError(as('admin', `insert into activity_log (action, summary) values ('fake','x')`));
  const del = await as('admin', 'delete from activity_log returning id').catch(() => []);
  expect(del.length === 0, 'log rows deleted');
  await expectError(as('admin', `select log_activity('fake','x','1','x')`));
});

console.log('\nInsights');
await db.exec(`insert into social_posts (id, platform, external_id, posted_at, views, likes)
  values ('instagram:1','instagram','1', now(), 500, 40)`);
await check('insights visible only with the Insights section', async () => {
  expect((await as('strategy', 'select * from social_posts')).length === 1, 'strategy cannot see');
  expect((await as('staff', 'select * from social_posts')).length === 0, 'staff can see');
});
await check('media team can tag a pillar but not change numbers', async () => {
  const ok = await as('strategy', `update social_posts set pillar='Play Here' where id='instagram:1' returning pillar`);
  expect(ok[0]?.pillar === 'Play Here', 'could not tag');
  await expectError(as('strategy', `update social_posts set views=999999 where id='instagram:1'`));
});
await check('Meta token is unreachable from the website', async () => {
  await db.exec(`select store_social_token('SECRET-TOKEN')`);
  await expectError(as('admin', 'select get_social_token()'));
  await expectError(as('admin', 'select * from private.social_tokens'));
});

// ---------------------------------------------------------------------------
console.log('\nGeneral chat');
const [{ id: general }] = await db.query(`select id from chats where is_default`).then((r) => r.rows);
await check('everyone is in General, including brand-new accounts', async () => {
  const id = '00000000-0000-0000-0000-000000000099';
  await db.query(`insert into auth.users values ($1, 'new@test')`, [id]);
  await db.query(`insert into profiles (id, username, full_name, role, permissions)
    select $1, 'newbie', 'Newbie', 'staff', permissions from role_presets where role='staff'`, [id]);
  const missing = (await db.query(`select username from profiles p where active
    and not exists (select 1 from chat_members m where m.chat_id=$1 and m.user_id=p.id)`, [general])).rows;
  expect(missing.length === 0, `not in General: ${JSON.stringify(missing)}`);
});
await check('nobody can be removed from General or delete it', async () => {
  await expectError(as('admin', 'select set_group_members($1, array[]::uuid[])', [general]));
  const left = await as('staff', 'delete from chat_members where chat_id=$1 and user_id=$2 returning user_id', [general, U.staff]);
  expect(left.length === 0, 'staff left General');
  const del = await as('admin', 'delete from chats where id=$1 returning id', [general]);
  expect(del.length === 0, 'General deleted');
});
await check('General is pinned first in the chat list', async () => {
  const rows = await as('staff', 'select is_default from chat_list()');
  expect(rows[0]?.is_default === true, JSON.stringify(rows.slice(0, 2)));
});

console.log('\nPillars & categories');
await check('only the admin can add, rename or remove pillars/categories', async () => {
  await expectError(as('strategy', `insert into pillars (name) values ('Hacked')`));
  await as('admin', `insert into pillars (name, color) values ('Tournaments', '#123456')`);
  await as('admin', `insert into request_types (name) values ('Podcast')`);
  const [r] = await as('strategy', `insert into requests (title, type, pillar, requester_id) values ('Pod','Podcast','Tournaments',$1) returning id`, [U.strategy]);
  await as('admin', `update pillars set name='Tournament Hype' where name='Tournaments'`);
  const [after] = await as('strategy', 'select pillar from requests where id=$1', [r.id]);
  expect(after.pillar === 'Tournament Hype', `rename did not cascade: ${after.pillar}`);
});
await check('requests can only use real categories', () =>
  expectError(as('staff', `insert into requests (title, type) values ('x','Not a type')`)));

console.log('\nStrategy → Execution workflow');
const [wf] = await as('staff', `insert into requests (title, type) values ('Workflow test','Reel') returning id, number`);
await check('a new request notifies the Strategy team', async () => {
  const n = await as('strategy', `select * from notifications where kind='request.new' and link=$1`, [`/r/${wf.number}`]);
  expect(n.length === 1, `strategy got ${n.length}`);
  const e = await as('exec', `select * from notifications where kind='request.new'`).catch(() => []);
  expect(e.length === 0, 'execution was notified too early');
});
await check('staff cannot approve; Strategy can', async () => {
  await expectError(as('staff', 'select approve_request($1)', [wf.id]));
  await as('strategy', 'select approve_request($1)', [wf.id]);
  const [r] = await as('admin', 'select status, section from requests where id=$1', [wf.id]);
  expect(r.status === 'Ready for Execution' && r.section === 'Execution', JSON.stringify(r));
  const s = await as('strategy', 'select id from requests where id=$1', [wf.id]);
  expect(s.length === 0, 'Strategy still sees it after handing it to Execution');
});
await check('approval notifies Execution and the requester', async () => {
  const admin = await as('admin', `select * from notifications where kind='request.approved'`);
  expect(admin.length === 1, `admin (execution) got ${admin.length}`);
  const mine = await as('staff', `select * from notifications where kind='request.status'`);
  expect(mine.some((n) => n.title.includes('Ready for Execution')), JSON.stringify(mine));
});
await check('approving twice is refused', () => expectError(as('strategy', 'select approve_request($1)', [wf.id])));
await check('you only see your own notifications', async () => {
  const theirs = await as('staff2', `select * from notifications where user_id <> $1`, [U.staff2]);
  expect(theirs.length === 0, 'saw other people\'s notifications');
});

console.log('\nPosting goals');
await check('everyone can read goals; only the admin can change them', async () => {
  expect((await as('staff', 'select * from content_goals')).length === 2, 'staff cannot read goals');
  await expectError(as('manager', `insert into content_goals (name, kind, target) values ('Stories','story',5)`));
  const upd = await as('strategy', `update content_goals set target=99 returning id`);
  expect(upd.length === 0, 'strategy changed a goal');
  await as('admin', `insert into content_goals (name, kind, target, period) values ('Stories','story',20,'month')`);
});

console.log('\nCalendar');
const [shoot] = await as('admin', `insert into calendar_items (type, title, starts_at, request_id)
  values ('Shoot', 'Film reel', now() + interval '1 day', $1) returning id`, [wf.id]);
await as('admin', 'insert into calendar_assignees values ($1, $2)', [shoot.id, U.staff]);
const [meet] = await as('admin', `insert into calendar_items (type, title, starts_at) values ('Meeting', 'Mgmt sync', now()) returning id`);
await check('scheduling someone notifies them', async () => {
  const n = await as('staff', `select * from notifications where kind='calendar.assigned'`);
  expect(n.length === 1 && n[0].body.includes('Film reel'), JSON.stringify(n));
});
await check('"own calendar only" people see just their items', async () => {
  const ids = (await as('staff', 'select id from calendar_items')).map((r) => r.id);
  expect(ids.includes(shoot.id) && !ids.includes(meet.id), JSON.stringify(ids));
});
await check('"everyone\'s calendar" toggle shows the whole calendar', async () => {
  await as('admin', `update profiles set permissions = permissions || '{calendar.view_all}' where id=$1`, [U.staff]);
  const n = (await as('staff', 'select id from calendar_items')).length;
  expect(n === 2, `saw ${n}`);
  await as('admin', `update profiles set permissions = array_remove(permissions, 'calendar.view_all') where id=$1`, [U.staff]);
});
await check('only people with "edit calendar" can add or change items', async () => {
  await expectError(as('staff', `insert into calendar_items (type, title, starts_at) values ('Shoot','x', now())`));
  const upd = await as('staff', `update calendar_items set title='hacked' where id=$1 returning id`, [shoot.id]);
  expect(upd.length === 0, 'staff edited an item');
});
await check('turning off the Calendar section hides it', async () => {
  await as('admin', `update profiles set permissions = array_remove(permissions, 'section.calendar') where id=$1`, [U.staff]);
  expect((await as('staff', 'select id from calendar_items')).length === 0, 'still visible');
  await as('admin', `update profiles set permissions = permissions || '{section.calendar}' where id=$1`, [U.staff]);
});

console.log('\nPush notifications');
await check('you can register your own device', async () => {
  await as('staff', `select save_push_subscription('https://push.example/abc', 'k1', 'a1', 'iPhone')`);
  const rows = await as('staff', 'select user_id from push_subscriptions');
  expect(rows.length === 1 && rows[0].user_id === U.staff, JSON.stringify(rows));
});
await check('other people cannot see your devices; the admin can', async () => {
  expect((await as('staff2', 'select * from push_subscriptions')).length === 0, 'staff2 saw a device');
  expect((await as('admin', 'select * from push_subscriptions')).length === 1, 'admin could not see devices');
});
await check('signing in as someone else on the same phone moves the device', async () => {
  await as('staff2', `select save_push_subscription('https://push.example/abc', 'k2', 'a2', 'iPhone')`);
  expect((await as('staff', 'select * from push_subscriptions')).length === 0, 'still linked to the old person');
  expect((await as('staff2', 'select * from push_subscriptions')).length === 1, 'not linked to the new person');
});
await check('nobody can add a device directly for someone else', () =>
  expectError(as('staff', `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://x', 'k', 'a')`, [U.staff2])));
await check('you can change your own notification settings', async () => {
  const rows = await as('staff', `update profiles set notify_prefs = '{"chat.general": false}' where id=$1 returning notify_prefs`, [U.staff]);
  expect(rows[0]?.notify_prefs['chat.general'] === false, 'not saved');
});
await check('you cannot change someone else\'s settings; the admin can', async () => {
  const mine = await as('staff', `update profiles set notify_prefs = '{}' where id=$1 returning id`, [U.staff2]);
  expect(mine.length === 0, 'staff changed staff2');
  const adm = await as('admin', `update profiles set notify_prefs = '{"chat.message": false}' where id=$1 returning id`, [U.staff2]);
  expect(adm.length === 1, 'admin could not change settings');
});

console.log('\nNotification fixes');
const [nr] = await as('staff2', `insert into requests (title, type) values ('Notify test','Reel') returning id, number`);
await check('being assigned to a request notifies you', async () => {
  await as('admin', 'insert into request_assignees values ($1, $2)', [nr.id, U.staff]);
  const n = await as('staff', `select * from notifications where kind='request.assigned' and link=$1`, [`/r/${nr.number}`]);
  expect(n.length === 1 && n[0].actor_id === U.admin, JSON.stringify(n));
});
await check('status changes notify the requester and everyone assigned', async () => {
  await as('admin', `update requests set status='In Strategy' where id=$1`, [nr.id]);
  for (const u of ['staff', 'staff2']) {
    const n = await as(u, `select * from notifications where kind='request.status' and link=$1`, [`/r/${nr.number}`]);
    expect(n.length === 1, `${u} got ${n.length}`);
  }
});
await check('people assigned later join the comment thread', async () => {
  const [{ request_chat: cid }] = await as('staff2', 'select request_chat($1)', [nr.id]);
  await as('admin', 'insert into request_assignees values ($1, $2)', [nr.id, U.lead]);
  const m = await as('admin', 'select user_id from chat_members where chat_id=$1 and user_id=$2', [cid, U.lead]);
  expect(m.length === 1, 'lead not added to the thread');
});
await check('you can mute a chat you are in, but not one you cannot see', async () => {
  const [g] = await as('admin', 'select id from chats where is_default');
  await as('staff', 'select set_chat_muted($1, true)', [g.id]);
  const [m] = await as('staff', 'select muted from chat_members where chat_id=$1 and user_id=$2', [g.id, U.staff]);
  expect(m.muted === true, 'not muted');
  const [dm] = await as('admin', `select start_dm($1) as id`, [U.staff2]);
  await expectError(as('staff', 'select set_chat_muted($1, true)', [dm.id]));
});

console.log('\nLibrary');
const [doc] = await as('strategy', `insert into library_docs (title, kind, body) values ('Turkey Shootout reel', 'Script', 'HOOK: v1') returning id, created_by`);
await check('the media team can add scripts to the Library', async () => {
  expect(doc.created_by === U.strategy, JSON.stringify(doc));
});
await check('team members cannot see the Library by default', async () => {
  expect((await as('staff', 'select * from library_docs')).length === 0, 'staff saw library docs');
  await expectError(as('staff', `insert into library_docs (title) values ('x')`));
});
await check('managers can read but not edit', async () => {
  expect((await as('manager', 'select * from library_docs')).length === 1, 'manager cannot read');
  const upd = await as('manager', `update library_docs set body='hacked' where id=$1 returning id`, [doc.id]);
  expect(upd.length === 0, 'manager edited');
});
await check('editing keeps the previous version', async () => {
  await as('admin', `update library_docs set body='HOOK: v2' where id=$1`, [doc.id]);
  const v = await as('strategy', 'select body, saved_by from library_versions where doc_id=$1', [doc.id]);
  expect(v.length === 1 && v[0].body === 'HOOK: v1' && v[0].saved_by === U.strategy, JSON.stringify(v));
  const [d] = await as('strategy', 'select updated_by, created_by from library_docs where id=$1', [doc.id]);
  expect(d.updated_by === U.admin && d.created_by === U.strategy, JSON.stringify(d));
});
await check('only the creator or admin can delete for good', async () => {
  const del = await as('claude', 'delete from library_docs where id=$1 returning id', [doc.id]);
  expect(del.length === 0, 'claude deleted someone else\'s doc');
  const own = await as('strategy', 'delete from library_docs where id=$1 returning id', [doc.id]);
  expect(own.length === 1, 'creator could not delete');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
