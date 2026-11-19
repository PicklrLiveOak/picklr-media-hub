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
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
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
await check('strategy, execution and Claude see everything', async () => {
  for (const u of ['strategy', 'exec', 'claude']) {
    const n = (await as(u, 'select id from requests')).length;
    expect(n === 3, `${u} saw ${n}`);
  }
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
    values ($1::uuid, 'requests/'||$1::text||'/a.jpg', 'a.jpg', 'image/jpeg', 1000)`, [r1.id]);
  const rows = await as('staff2', 'select * from request_files');
  expect(rows.length === 0, 'leak');
});
await check('files over 10 MB are rejected', () =>
  expectError(as('strategy', `insert into request_files (request_id, storage_path, file_name, mime, size_bytes)
    values ($1::uuid, 'requests/'||$1::text||'/big.pdf', 'big.pdf', 'application/pdf', 20000000)`, [r1.id])));
await check('videos cannot be uploaded (Drive links only)', () =>
  expectError(as('strategy', `insert into request_files (request_id, storage_path, file_name, mime, size_bytes)
    values ($1::uuid, 'requests/'||$1::text||'/v.mp4', 'v.mp4', 'video/mp4', 1000)`, [r1.id])));

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
