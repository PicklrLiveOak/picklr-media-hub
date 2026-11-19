// Account + test-data helper. Runs on YOUR computer only, using the service
// role key from .env.local (never committed, never in GitHub).
//
//   node scripts/seed.mjs admin            → create your admin account (asks for details)
//   node scripts/seed.mjs test             → create 5 test users + sample requests
//                                            (logins saved to test-accounts.local.txt)
//   node scripts/seed.mjs remove-test      → delete the test users and their requests
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

// Must match LOGIN_EMAIL_DOMAIN in src/lib/supabase.ts
const DOMAIN = 'staff.picklr-hub.example.com';

// --- load .env.local -------------------------------------------------------
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Put VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
  process.exit(1);
}
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const dept = async (name) => (await db.from('departments').select('id').eq('name', name).single()).data?.id ?? null;
const preset = async (role) => (await db.from('role_presets').select('permissions').eq('role', role).single()).data.permissions;

async function createUser({ username, password, full_name, role, department }) {
  const { data, error } = await db.auth.admin.createUser({ email: `${username}@${DOMAIN}`, password, email_confirm: true });
  if (error) throw new Error(`${username}: ${error.message}`);
  const { error: pe } = await db.from('profiles').insert({
    id: data.user.id, username, full_name, role,
    department_id: department ? await dept(department) : null,
    permissions: await preset(role),
    is_service_account: role === 'claude',
  });
  if (pe) { await db.auth.admin.deleteUser(data.user.id); throw new Error(`${username}: ${pe.message}`); }
  return data.user.id;
}

const cmd = process.argv[2];

if (cmd === 'admin') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const full_name = await rl.question('Your full name: ');
  const username = (await rl.question('Username (e.g. nehemiah): ')).trim().toLowerCase();
  const password = await rl.question('Password (8+ characters): ');
  rl.close();
  await createUser({ username, password, full_name, role: 'admin', department: 'Media (Execution)' });
  console.log(`\n✓ Admin account created. Sign in as "${username}".`);
}

else if (cmd === 'test') {
  const people = [
    { username: 'test.strategy', full_name: 'Test Strategy', role: 'strategy', department: 'Media (Strategy)' },
    { username: 'test.exec', full_name: 'Test Execution', role: 'execution', department: 'Media (Execution)' },
    { username: 'test.lead', full_name: 'Test Sales Lead', role: 'lead', department: 'Sales' },
    { username: 'test.staff', full_name: 'Test Sales Staff', role: 'staff', department: 'Sales' },
    { username: 'test.frontdesk', full_name: 'Test Front Desk', role: 'staff', department: 'Front Desk' },
  ];
  const ids = {};
  const lines = ['# Test logins for Picklr Media Hub (do not commit)', ''];
  for (const p of people) {
    const password = 'test-' + randomBytes(6).toString('hex');
    ids[p.username] = await createUser({ ...p, password });
    lines.push(`${p.username.padEnd(16)} ${password}   (${p.role}, ${p.department})`);
  }
  writeFileSync('test-accounts.local.txt', lines.join('\n') + '\n');

  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const sales = await dept('Sales'), front = await dept('Front Desk'), events = await dept('Events & Leagues');
  const reqs = [
    { title: 'Black Friday membership promo graphic', type: 'Graphic', status: 'New', requester_id: ids['test.staff'], department_id: sales, needed_by: day(5), pillar: 'Offers + Bookings', details: '20% off first month. Need feed post + story.' },
    { title: 'Front desk "How to book a court" sign', type: 'Graphic', status: 'New', requester_id: ids['test.frontdesk'], department_id: front, needed_by: day(10), details: 'Printable 11x17.' },
    { title: 'Turkey Shootout hype reel', type: 'Reel', status: 'In Strategy', requester_id: ids['test.lead'], department_id: sales, event_name: 'Turkey Shootout', event_date: day(7), needed_by: day(3), pillar: 'Event Hype + Recap', priority: 'High', brief: 'HOOK: "Who\'s taking home the turkey?"\nShots: paddles up, crowd, trophy.' },
    { title: 'Coach spotlight: Saturday clinic', type: 'Video', status: 'Ready for Execution', requester_id: ids['test.strategy'], department_id: events, needed_by: day(6), pillar: 'People of The Picklr', section: 'Execution' },
    { title: 'Friday Night Mixer livestream', type: 'Livestream', status: 'In Production', requester_id: ids['test.strategy'], department_id: events, event_date: day(1), needed_by: day(1), pillar: 'Event Hype + Recap', section: 'Execution', priority: 'Urgent' },
    { title: 'Paddle grip tips carousel', type: 'Graphic', status: 'Scheduled', requester_id: ids['test.strategy'], pillar: 'Gear + Tips', needed_by: day(-1) },
    { title: 'Beginner clinic recap', type: 'Reel', status: 'Posted', requester_id: ids['test.lead'], department_id: sales, pillar: 'Play Here', needed_by: day(-4) },
  ];
  for (const r of reqs) {
    const { data, error } = await db.from('requests').insert({ ...r, created_by: r.requester_id }).select('id, status').single();
    if (error) throw error;
    if (r.status !== 'New') {
      const who = r.section === 'Execution' ? ids['test.exec'] : ids['test.strategy'];
      await db.from('request_assignees').insert({ request_id: data.id, user_id: who });
    }
  }
  console.log(`✓ Created ${people.length} test users and ${reqs.length} requests.`);
  console.log('  Logins are in test-accounts.local.txt');
}

else if (cmd === 'remove-test') {
  const { data: users } = await db.from('profiles').select('id, username').like('username', 'test.%');
  for (const u of users ?? []) {
    await db.from('requests').delete().or(`requester_id.eq.${u.id},created_by.eq.${u.id}`);
    await db.auth.admin.deleteUser(u.id); // profile is removed by cascade
    console.log('removed', u.username);
  }
}

else {
  console.log('Usage: node scripts/seed.mjs admin | test | remove-test');
}
