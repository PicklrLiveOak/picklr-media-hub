// mcp — Media Hub as a connector for the Claude apps (MCP, Streamable HTTP).
//
// Add in Claude → Settings → Connectors → Add custom connector:
//   https://dkfimkjsolqhxtuqxdew.supabase.co/functions/v1/mcp
//
// Sign-in: Supabase Auth's OAuth 2.1 server. Claude opens Media Hub's approval
// page (#/oauth), the person signs in and taps Approve, and Claude gets a token
// for THAT person. Every database call then runs as them, so the app's normal
// permissions (RLS) apply. Needs the "claude.connect" permission (admins have it).
//
// "as": "claude" — the admin can ask Claude to act as the separate Claude
// service account instead (needs the CLAUDE_ACCOUNT_PASSWORD secret).
//
// Everything Claude changes is written to the activity log (source "mcp"),
// and chat messages it sends are tagged "via Claude".
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOURCE = `${SUPABASE_URL}/functions/v1/mcp`;
const TZ = 'America/Chicago';
const LOGIN_DOMAIN = 'staff.picklr-hub.example.com';
const APP_URL = 'https://picklrliveoak.github.io/picklr-media-hub/#';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });

type Json = Record<string, any>;
type Profile = { id: string; username: string; full_name: string; role: string; active: boolean; permissions: string[]; is_service_account: boolean };
type Ctx = { db: SupabaseClient; me: Profile; asClaude: boolean; admin: SupabaseClient; team: Profile[] };

// ---------- helpers ---------------------------------------------------------
const fmtWhen = (ts: string | null) => ts ? new Date(ts).toLocaleString('en-US', {
  timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

/** "2026-11-28 14:00" (San Antonio time) or full ISO → ISO UTC */
function toISO(s: string) {
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) return new Date(s).toISOString();
  const [d, t = '00:00'] = s.trim().split(/[ T]/);
  const guess = new Date(`${d}T${t.length === 5 ? `${t}:00` : t}Z`);
  if (isNaN(guess.getTime())) throw new Error(`Couldn't read the date/time "${s}". Use YYYY-MM-DD HH:MM.`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
  return new Date(guess.getTime() + (guess.getTime() - local.getTime())).toISOString();
}

function findPerson(team: Profile[], who: string) {
  const q = who.trim().replace(/^@/, '').toLowerCase();
  const hit = team.find((t) => t.username === q) ?? team.find((t) => t.full_name.toLowerCase() === q)
    ?? team.filter((t) => t.full_name.toLowerCase().includes(q)).at(0);
  if (!hit) throw new Error(`No one on the team matches "${who}". Use list_team to see usernames.`);
  return hit;
}
const nameOf = (team: Profile[], id: string | null) => team.find((t) => t.id === id)?.full_name ?? 'Someone';

async function getRequest(ctx: Ctx, number: number) {
  const { data, error } = await ctx.db.from('requests').select('*, request_assignees(user_id)').eq('number', number).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Request #${number} not found (or ${ctx.asClaude ? 'the Claude account' : 'you'} can't see it).`);
  return data as Json;
}

async function log(ctx: Ctx, action: string, summary: string, target?: { type: string; id: string }) {
  await ctx.admin.from('activity_log').insert({
    actor_id: ctx.me.id, source: 'mcp', action: `claude.${action}`,
    summary: `${ctx.asClaude ? 'Claude account' : `Claude for ${ctx.me.full_name}`}: ${summary}`,
    target_type: target?.type ?? null, target_id: target?.id ?? null,
  });
}

function mentionsIn(team: Profile[], text: string) {
  return [...new Set([...text.matchAll(/@([a-z0-9._-]+)/gi)]
    .map((m) => team.find((t) => t.username === m[1].toLowerCase())?.id).filter(Boolean))] as string[];
}

/** Resolve "General", a group name, a person, or "#101" to a chat the actor can post in. */
async function resolveChat(ctx: Ctx, to: string) {
  const t = to.trim();
  const num = t.match(/^#?(\d+)$/);
  if (num) {
    const r = await getRequest(ctx, Number(num[1]));
    const { data, error } = await ctx.db.rpc('request_chat', { rid: r.id });
    if (error) throw error;
    return { id: data as string, label: `comments on #${r.number}`, kind: 'request' };
  }
  const { data: chats } = await ctx.db.from('chats').select('id, kind, name, is_default');
  const group = (chats ?? []).find((c) => c.kind === 'group' && c.name?.toLowerCase() === t.toLowerCase().replace(/^#/, ''));
  if (group) return { id: group.id, label: group.name, kind: 'group' };
  const person = findPerson(ctx.team, t);
  const actorId = ctx.asClaude ? ctx.team.find((x) => x.role === 'claude')?.id : ctx.me.id;
  if (person.id === actorId) throw new Error("That's yourself. Pick another person or a group.");
  const { data, error } = await ctx.db.rpc('start_dm', { other: person.id });
  if (error) throw error;
  return { id: data as string, label: `DM with ${person.full_name}`, kind: 'dm' };
}

// ---------- tools -------------------------------------------------------------
const AS = { type: 'string', enum: ['me', 'claude'], description: 'Act as the signed-in person ("me", default) or as the separate Claude account ("claude", admin only).' };

const TOOLS: { name: string; description: string; inputSchema: Json; write?: boolean; annotations?: Json;
  run: (ctx: Ctx, a: Json) => Promise<unknown> }[] = [
  {
    name: 'get_overview',
    description: 'Start here. Who I am, my unread notifications, my team queues (Strategy/Execution), request counts by status, unread chats and the next 7 days of calendar.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async run(ctx) {
      const [notes, reqs, chats, cal] = await Promise.all([
        ctx.db.from('notifications').select('kind, title, body, link, created_at').is('read_at', null).order('created_at', { ascending: false }).limit(10),
        ctx.db.from('requests').select('number, title, status, section, pillar, priority, needed_by').neq('status', 'Posted').order('needed_by', { ascending: true, nullsFirst: false }),
        ctx.db.rpc('chat_list'),
        ctx.db.from('calendar_items').select('type, title, starts_at, location').gte('starts_at', new Date().toISOString())
          .lte('starts_at', new Date(Date.now() + 7 * 864e5).toISOString()).order('starts_at'),
      ]);
      const open = (reqs.data ?? []) as Json[];
      const byStatus: Record<string, number> = {};
      for (const r of open) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      const isAdmin = ctx.me.role === 'admin';
      return {
        acting_as: ctx.asClaude ? 'Claude account' : ctx.me.full_name,
        me: { name: ctx.me.full_name, username: ctx.me.username, role: ctx.me.role },
        today: new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        unread_notifications: notes.data ?? [],
        open_requests_by_status: byStatus,
        strategy_queue: (isAdmin || ctx.me.permissions.includes('team.strategy')) ? open.filter((r) => ['New', 'In Strategy'].includes(r.status)) : undefined,
        ready_to_produce: (isAdmin || ctx.me.permissions.includes('team.execution')) ? open.filter((r) => ['Ready for Execution', 'In Production'].includes(r.status)) : undefined,
        unread_chats: ((chats.data ?? []) as Json[]).filter((c) => c.unread > 0).map((c) => ({ chat: c.name ?? (c.request_number ? `#${c.request_number}` : nameOf(ctx.team, c.other_user)), unread: c.unread, last: c.last_body })),
        next_7_days: ((cal.data ?? []) as Json[]).map((e) => ({ ...e, starts_at: fmtWhen(e.starts_at) })),
      };
    },
  },
  {
    name: 'whats_new',
    description: 'Everything new since the last briefing (or since a time you pass): new requests, requests that changed, new chat messages (with @mentions flagged), things due soon and the next 48 hours of calendar. Built for scheduled briefings.',
    inputSchema: { type: 'object', properties: {
      since: { type: 'string', description: 'ISO time. Default: when the Claude account last sent a 📋 briefing DM to briefing_for (or 24 hours ago).' },
      briefing_for: { type: 'string', description: 'Username the briefings go to, used to find the last briefing time. Default: me.' },
    } },
    annotations: { readOnlyHint: true },
    async run(ctx, a) {
      const forUser = a.briefing_for ? findPerson(ctx.team, String(a.briefing_for)) : ctx.me;
      const claude = ctx.team.find((t) => t.role === 'claude');
      let since = a.since ? new Date(a.since).toISOString() : '';
      let lastBriefing: string | null = null;
      if (claude) {
        // Last 📋 DM from the Claude account to that person (service role: just a timestamp)
        const { data: dms } = await ctx.admin.from('messages').select('created_at, chat_id, chats!inner(kind)')
          .eq('author_id', claude.id).eq('chats.kind', 'dm').like('body', '📋%').order('created_at', { ascending: false }).limit(20);
        for (const m of (dms ?? []) as Json[]) {
          const { count } = await ctx.admin.from('chat_members').select('user_id', { count: 'exact', head: true }).eq('chat_id', m.chat_id).eq('user_id', forUser.id);
          if (count) { lastBriefing = m.created_at; break; }
        }
      }
      if (!since) since = lastBriefing ?? new Date(Date.now() - 24 * 3600e3).toISOString();
      const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
      const [created, changed, msgs, due, cal] = await Promise.all([
        ctx.db.from('requests').select('number, title, type, status, pillar, priority, needed_by, event_name, event_date, details, brief, requester_id, department_label, created_at')
          .gt('created_at', since).order('created_at'),
        ctx.db.from('requests').select('number, title, status, pillar, priority, needed_by, updated_at').gt('updated_at', since).lte('created_at', since).order('updated_at'),
        ctx.db.from('messages').select('author_id, body, mentions, internal, created_at, attachment_path, chats!inner(kind, name, is_default, request_id)')
          .gt('created_at', since).order('created_at').limit(200),
        ctx.db.from('requests').select('number, title, status, needed_by').lte('needed_by', soon).neq('status', 'Posted').order('needed_by'),
        ctx.db.from('calendar_items').select('type, title, starts_at, location, calendar_assignees(user_id)')
          .gte('starts_at', new Date().toISOString()).lte('starts_at', new Date(Date.now() + 2 * 864e5).toISOString()).order('starts_at'),
      ]);
      const reqNum = new Map<string, number>();
      const ids = [...new Set(((msgs.data ?? []) as Json[]).map((m) => m.chats.request_id).filter(Boolean))];
      if (ids.length) for (const r of ((await ctx.db.from('requests').select('id, number').in('id', ids)).data ?? []) as Json[]) reqNum.set(r.id, r.number);
      const watch = new Set([ctx.me.id, forUser.id]);
      return {
        since, since_local: fmtWhen(since), last_briefing_at: fmtWhen(lastBriefing), briefing_for: forUser.username,
        new_requests: ((created.data ?? []) as Json[]).map((r) => ({ ...r, requester: nameOf(ctx.team, r.requester_id), requester_id: undefined,
          has_brief: !!r.brief, brief: undefined, details: (r.details ?? '').slice(0, 600), submitted: fmtWhen(r.created_at), created_at: undefined })),
        updated_requests: ((changed.data ?? []) as Json[]).map((r) => ({ ...r, updated: fmtWhen(r.updated_at), updated_at: undefined })),
        new_messages: ((msgs.data ?? []) as Json[]).filter((m) => m.author_id !== claude?.id).map((m) => ({
          chat: m.chats.kind === 'request' ? `#${reqNum.get(m.chats.request_id) ?? '?'} comments` : m.chats.kind === 'dm' ? `DM` : m.chats.name,
          from: nameOf(ctx.team, m.author_id), at: fmtWhen(m.created_at), text: m.body || (m.attachment_path ? '[photo]' : ''),
          mentions_you: (m.mentions ?? []).some((x: string) => watch.has(x)) || undefined, internal: m.internal || undefined })),
        due_within_3_days: due.data ?? [],
        next_48_hours: ((cal.data ?? []) as Json[]).map((e) => ({ type: e.type, title: e.title, when: fmtWhen(e.starts_at), location: e.location,
          people: (e.calendar_assignees ?? []).map((x: Json) => nameOf(ctx.team, x.user_id)) })),
      };
    },
  },
  {
    name: 'list_requests',
    description: 'Search media requests the user can see. Filter by status, pillar, type, or text.',
    inputSchema: { type: 'object', properties: {
      status: { type: 'string', description: 'New, In Strategy, Ready for Execution, In Production, Scheduled, Posted, On Hold' },
      pillar: { type: 'string' }, type: { type: 'string' }, search: { type: 'string' },
      include_posted: { type: 'boolean', description: 'Include finished (Posted) requests. Default false.' },
      limit: { type: 'number', description: 'Default 25, max 100' },
    } },
    annotations: { readOnlyHint: true },
    async run(ctx, a) {
      let q = ctx.db.from('requests').select('number, title, type, status, pillar, priority, needed_by, event_name, event_date, requester_id, request_assignees(user_id)')
        .order('number', { ascending: false }).limit(Math.min(Number(a.limit) || 25, 100));
      if (a.status) q = q.eq('status', a.status);
      else if (!a.include_posted) q = q.neq('status', 'Posted');
      if (a.pillar) q = q.eq('pillar', a.pillar);
      if (a.type) q = q.eq('type', a.type);
      if (a.search) q = q.ilike('title', `%${String(a.search).replace(/[%_]/g, '')}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r: Json) => ({ ...r, requester: nameOf(ctx.team, r.requester_id), requester_id: undefined,
        assigned: (r.request_assignees ?? []).map((x: Json) => nameOf(ctx.team, x.user_id)), request_assignees: undefined }));
    },
  },
  {
    name: 'get_request',
    description: 'Everything about one request: details, brief/script, links, files, people, calendar items and recent comments.',
    inputSchema: { type: 'object', properties: { number: { type: 'number' } }, required: ['number'] },
    annotations: { readOnlyHint: true },
    async run(ctx, a) {
      const r = await getRequest(ctx, Number(a.number));
      const [files, cal, chat] = await Promise.all([
        ctx.db.from('request_files').select('file_name, mime, created_at').eq('request_id', r.id),
        ctx.db.from('calendar_items').select('type, title, starts_at, location').eq('request_id', r.id),
        ctx.db.from('chats').select('id').eq('request_id', r.id).maybeSingle(),
      ]);
      let comments: Json[] = [];
      if (chat.data) {
        const { data } = await ctx.db.from('messages').select('author_id, body, internal, created_at, via')
          .eq('chat_id', chat.data.id).order('created_at', { ascending: false }).limit(30);
        comments = (data ?? []).reverse().map((m: Json) => ({ from: nameOf(ctx.team, m.author_id), at: fmtWhen(m.created_at),
          text: m.body, internal: m.internal || undefined, via: m.via ?? undefined }));
      }
      return {
        number: r.number, title: r.title, type: r.type, status: r.status, stage: r.section, pillar: r.pillar, priority: r.priority,
        needed_by: r.needed_by, event: r.event_name ? { name: r.event_name, date: r.event_date } : null,
        department: r.department_label, requester: nameOf(ctx.team, r.requester_id),
        assigned: (r.request_assignees ?? []).map((x: Json) => nameOf(ctx.team, x.user_id)),
        details: r.details, brief_and_script: r.brief, links: r.drive_links, files: files.data ?? [],
        calendar: (cal.data ?? []).map((e: Json) => ({ ...e, starts_at: fmtWhen(e.starts_at) })), comments,
        link: `${APP_URL}/r/${r.number}`,
      };
    },
  },
  {
    name: 'get_options',
    description: 'Valid content pillars, request types (categories), statuses and priorities.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async run(ctx) {
      const [p, t] = await Promise.all([
        ctx.db.from('pillars').select('name').eq('active', true).order('sort'),
        ctx.db.from('request_types').select('name').eq('active', true).order('sort'),
      ]);
      return {
        pillars: (p.data ?? []).map((x: Json) => x.name), types: (t.data ?? []).map((x: Json) => x.name),
        statuses: ['New', 'In Strategy', 'Ready for Execution', 'In Production', 'Scheduled', 'Posted', 'On Hold'],
        priorities: ['Low', 'Normal', 'High', 'Urgent'],
        workflow: 'New → In Strategy (Strategy team writes the brief/script) → approve_request → Ready for Execution → In Production → Scheduled → Posted.',
      };
    },
  },
  {
    name: 'update_request',
    description: 'Change a request: status, pillar, type (category), priority, title, details, due date, event, or the brief/script. Use brief + brief_mode "append" to add a drafted script under the existing brief.',
    inputSchema: { type: 'object', properties: {
      number: { type: 'number' }, as: AS,
      status: { type: 'string' }, pillar: { type: 'string' }, type: { type: 'string' }, priority: { type: 'string' },
      title: { type: 'string' }, details: { type: 'string' }, needed_by: { type: 'string', description: 'YYYY-MM-DD' },
      event_name: { type: 'string' }, event_date: { type: 'string', description: 'YYYY-MM-DD' },
      brief: { type: 'string', description: 'Brief / hook / script text' },
      brief_mode: { type: 'string', enum: ['replace', 'append'], description: 'Default replace' },
    }, required: ['number'] },
    write: true,
    async run(ctx, a) {
      const r = await getRequest(ctx, Number(a.number));
      const patch: Json = {};
      for (const k of ['status', 'pillar', 'type', 'priority', 'title', 'details', 'needed_by', 'event_name', 'event_date']) if (a[k] !== undefined) patch[k] = a[k];
      if (a.brief !== undefined) patch.brief = a.brief_mode === 'append' && r.brief ? `${r.brief}\n\n${a.brief}` : a.brief;
      if (!Object.keys(patch).length) throw new Error('Nothing to change.');
      const { data, error } = await ctx.db.from('requests').update(patch).eq('id', r.id).select('number, status, pillar, type, priority').maybeSingle();
      if (error) {
        if (/foreign key|violates/.test(error.message)) throw new Error(`${error.message}. Call get_options for valid pillars/types.`);
        throw error;
      }
      const changed = Object.keys(patch).map((k) => k === 'brief' ? 'brief/script' : `${k} → ${patch[k]}`).join(', ');
      await log(ctx, 'request.update', `#${r.number} ${changed}`, { type: 'request', id: r.id });
      return { ok: true, updated: changed, now: data ?? '(saved; it has moved out of your view, e.g. to the other team’s stage)', link: `${APP_URL}/r/${r.number}` };
    },
  },
  {
    name: 'approve_request',
    description: 'Strategy approval: send a request to the Execution team (Ready for Execution). Notifies Execution.',
    inputSchema: { type: 'object', properties: { number: { type: 'number' }, as: AS }, required: ['number'] },
    write: true,
    async run(ctx, a) {
      const r = await getRequest(ctx, Number(a.number));
      const { error } = await ctx.db.rpc('approve_request', { rid: r.id });
      if (error) throw error;
      await log(ctx, 'request.approve', `#${r.number} approved for Execution`, { type: 'request', id: r.id });
      return { ok: true, number: r.number, status: 'Ready for Execution' };
    },
  },
  {
    name: 'create_request',
    description: 'Submit a new media request.',
    inputSchema: { type: 'object', properties: {
      as: AS, title: { type: 'string' }, type: { type: 'string', description: 'See get_options' }, details: { type: 'string' },
      needed_by: { type: 'string', description: 'YYYY-MM-DD' }, event_name: { type: 'string' }, event_date: { type: 'string' },
      pillar: { type: 'string' }, priority: { type: 'string' }, department: { type: 'string' },
    }, required: ['title', 'type'] },
    write: true,
    async run(ctx, a) {
      const row: Json = { title: a.title, type: a.type, details: a.details ?? null, needed_by: a.needed_by ?? null,
        event_name: a.event_name ?? null, event_date: a.event_date ?? null, department_label: a.department ?? null };
      if (a.pillar) row.pillar = a.pillar;
      if (a.priority) row.priority = a.priority;
      const { data, error } = await ctx.db.from('requests').insert(row).select('id, number').single();
      if (error) throw error;
      await log(ctx, 'request.create', `created #${data.number} ${a.title}`, { type: 'request', id: data.id });
      return { ok: true, number: data.number, link: `${APP_URL}/r/${data.number}` };
    },
  },
  {
    name: 'assign_people',
    description: 'Add or remove people on a request (by username or name).',
    inputSchema: { type: 'object', properties: { number: { type: 'number' }, as: AS,
      add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } }, required: ['number'] },
    write: true,
    async run(ctx, a) {
      const r = await getRequest(ctx, Number(a.number));
      const add = (a.add ?? []).map((w: string) => findPerson(ctx.team, w));
      const remove = (a.remove ?? []).map((w: string) => findPerson(ctx.team, w));
      for (const p of add) {
        const { error } = await ctx.db.from('request_assignees').upsert({ request_id: r.id, user_id: p.id }, { ignoreDuplicates: true });
        if (error) throw error;
      }
      for (const p of remove) {
        const { error } = await ctx.db.from('request_assignees').delete().eq('request_id', r.id).eq('user_id', p.id);
        if (error) throw error;
      }
      const summary = [add.length && `added ${add.map((p: Profile) => p.full_name).join(', ')}`, remove.length && `removed ${remove.map((p: Profile) => p.full_name).join(', ')}`].filter(Boolean).join('; ');
      await log(ctx, 'request.assign', `#${r.number} ${summary}`, { type: 'request', id: r.id });
      return { ok: true, number: r.number, changes: summary };
    },
  },
  {
    name: 'list_library',
    description: 'Search the Library: saved scripts, hooks, shot lists, captions, templates and notes for videos.',
    inputSchema: { type: 'object', properties: { search: { type: 'string' }, kind: { type: 'string', description: 'Script, Hook, Shot list, Caption, Template, Notes, Other' },
      pillar: { type: 'string' }, include_archived: { type: 'boolean' } } },
    annotations: { readOnlyHint: true },
    async run(ctx, a) {
      let q = ctx.db.from('library_docs').select('id, title, kind, pillar, tags, body, pinned, archived, updated_at, request_id')
        .order('pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(50);
      if (!a.include_archived) q = q.eq('archived', false);
      if (a.kind) q = q.eq('kind', a.kind);
      if (a.pillar) q = q.eq('pillar', a.pillar);
      if (a.search) { const t = String(a.search).replace(/[%_,()]/g, ''); q = q.or(`title.ilike.%${t}%,body.ilike.%${t}%`); }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((d: Json) => ({ id: d.id, title: d.title, kind: d.kind, pillar: d.pillar, tags: d.tags, pinned: d.pinned || undefined,
        archived: d.archived || undefined, updated: fmtWhen(d.updated_at), preview: d.body.slice(0, 160), link: `${APP_URL}/library/${d.id}` }));
    },
  },
  {
    name: 'get_library_doc',
    description: 'Read one Library doc in full (by id from list_library).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: true },
    async run(ctx, a) {
      const { data, error } = await ctx.db.from('library_docs').select('*').eq('id', a.id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Not found (or no Library access).');
      let request: number | null = null;
      if (data.request_id) request = (await ctx.db.from('requests').select('number').eq('id', data.request_id).maybeSingle()).data?.number ?? null;
      return { ...data, request_number: request, request_id: undefined, created_by: nameOf(ctx.team, data.created_by), updated_by: nameOf(ctx.team, data.updated_by),
        updated_at: fmtWhen(data.updated_at), link: `${APP_URL}/library/${data.id}` };
    },
  },
  {
    name: 'save_library_doc',
    description: 'Save a script, hook, shot list, caption, template or notes to the Library. Without id it creates a new doc; with id it updates one (the old text is kept as a version). Use body_mode "append" to add to the end.',
    inputSchema: { type: 'object', properties: {
      as: AS, id: { type: 'string', description: 'Existing doc to update' }, title: { type: 'string' },
      kind: { type: 'string', enum: ['Script', 'Hook', 'Shot list', 'Caption', 'Template', 'Notes', 'Other'] },
      pillar: { type: 'string' }, body: { type: 'string' }, body_mode: { type: 'string', enum: ['replace', 'append'] },
      tags: { type: 'array', items: { type: 'string' } }, request_number: { type: 'number', description: 'Link it to a request' },
    } },
    write: true,
    async run(ctx, a) {
      const row: Json = {};
      for (const k of ['title', 'kind', 'pillar']) if (a[k] !== undefined) row[k] = a[k];
      if (a.tags) row.tags = (a.tags as string[]).map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
      if (a.request_number) row.request_id = (await getRequest(ctx, Number(a.request_number))).id;
      if (a.id) {
        const { data: cur, error: e0 } = await ctx.db.from('library_docs').select('id, title, body').eq('id', a.id).maybeSingle();
        if (e0) throw e0;
        if (!cur) throw new Error('Doc not found (or no Library access).');
        if (a.body !== undefined) row.body = a.body_mode === 'append' && cur.body ? `${cur.body}\n\n${a.body}` : a.body;
        const { error } = await ctx.db.from('library_docs').update(row).eq('id', a.id);
        if (error) throw error;
        await log(ctx, 'library.update', `updated "${row.title ?? cur.title}" in the Library`, { type: 'library', id: a.id });
        return { ok: true, id: a.id, link: `${APP_URL}/library/${a.id}` };
      }
      if (!a.title) throw new Error('A new doc needs a title.');
      row.body = a.body ?? '';
      const { data, error } = await ctx.db.from('library_docs').insert(row).select('id').single();
      if (error) throw error;
      await log(ctx, 'library.create', `saved ${row.kind ?? 'Script'} "${a.title}" to the Library`, { type: 'library', id: data.id });
      return { ok: true, id: data.id, link: `${APP_URL}/library/${data.id}` };
    },
  },
  {
    name: 'list_team',
    description: 'Everyone on the team: name, username (for @mentions and DMs) and role.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async run(ctx) {
      return ctx.team.filter((t) => t.active).map((t) => ({ name: t.full_name, username: t.username, role: t.role,
        strategy: t.permissions.includes('team.strategy') || undefined, execution: t.permissions.includes('team.execution') || undefined }));
    },
  },
  {
    name: 'list_chats',
    description: 'My chats (General, groups, DMs, request threads) with unread counts and the latest message.',
    inputSchema: { type: 'object', properties: { as: AS } },
    annotations: { readOnlyHint: true },
    async run(ctx) {
      const { data, error } = await ctx.db.rpc('chat_list');
      if (error) throw error;
      return ((data ?? []) as Json[]).map((c) => ({ chat: c.name ?? (c.request_number ? `#${c.request_number} ${c.request_title}` : nameOf(ctx.team, c.other_user)), kind: c.kind, unread: c.unread,
        last: c.last_body, last_from: nameOf(ctx.team, c.last_author), at: fmtWhen(c.last_message_at) }));
    },
  },
  {
    name: 'read_chat',
    description: 'Read recent messages in a chat. "chat" is a group name (e.g. General), a person (username or name) for DMs, or a request number like #101 for its comments.',
    inputSchema: { type: 'object', properties: { chat: { type: 'string' }, limit: { type: 'number', description: 'Default 30, max 100' }, as: AS }, required: ['chat'] },
    annotations: { readOnlyHint: true },
    async run(ctx, a) {
      const c = await resolveChat(ctx, String(a.chat));
      const { data, error } = await ctx.db.from('messages').select('author_id, body, attachment_path, internal, created_at, via')
        .eq('chat_id', c.id).order('created_at', { ascending: false }).limit(Math.min(Number(a.limit) || 30, 100));
      if (error) throw error;
      return { chat: c.label, messages: (data ?? []).reverse().map((m: Json) => ({ from: nameOf(ctx.team, m.author_id), at: fmtWhen(m.created_at),
        text: m.body || (m.attachment_path ? '[photo]' : ''), internal: m.internal || undefined, via: m.via ?? undefined })) };
    },
  },
  {
    name: 'send_chat',
    description: 'Send a chat message. "to" is a group name (e.g. General), a person (username or name) for a DM, or #101 to comment on a request. @username mentions notify people. Messages show "via Claude". Only send what the user asked for.',
    inputSchema: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string' }, as: AS,
      internal: { type: 'boolean', description: 'Request comments only: media-team-only note' } }, required: ['to', 'text'] },
    write: true,
    async run(ctx, a) {
      const c = await resolveChat(ctx, String(a.to));
      const text = String(a.text).trim();
      if (!text) throw new Error('Message is empty.');
      const author = ctx.asClaude ? ctx.team.find((x) => x.role === 'claude')!.id : ctx.me.id;
      const { error } = await ctx.db.from('messages').insert({
        chat_id: c.id, author_id: author, body: text, mentions: mentionsIn(ctx.team, text),
        link_url: text.match(/https?:\/\/\S+/)?.[0] ?? null, internal: c.kind === 'request' && !!a.internal,
        via: ctx.asClaude ? null : 'claude',
      });
      if (error) throw error;
      await log(ctx, 'chat.send', `message to ${c.label}: "${text.slice(0, 80)}"`, { type: 'chat', id: c.id });
      return { ok: true, sent_to: c.label };
    },
  },
  {
    name: 'list_calendar',
    description: 'Calendar items (shoots, posts, meetings, events) the user can see, between two dates.',
    inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD, default today' },
      days: { type: 'number', description: 'How many days, default 14' }, as: AS } },
    annotations: { readOnlyHint: true },
    async run(ctx, a) {
      const start = a.from ? toISO(`${a.from} 00:00`) : new Date().toISOString();
      const end = new Date(new Date(start).getTime() + (Number(a.days) || 14) * 864e5).toISOString();
      const { data, error } = await ctx.db.from('calendar_items').select('id, type, title, starts_at, ends_at, all_day, location, notes, request_id, calendar_assignees(user_id)')
        .gte('starts_at', start).lt('starts_at', end).order('starts_at');
      if (error) throw error;
      return (data ?? []).map((e: Json) => ({ type: e.type, title: e.title, when: e.all_day ? new Date(e.starts_at).toLocaleDateString('en-US', { timeZone: TZ, dateStyle: 'medium' }) : fmtWhen(e.starts_at),
        ends: fmtWhen(e.ends_at), location: e.location, notes: e.notes, people: (e.calendar_assignees ?? []).map((x: Json) => nameOf(ctx.team, x.user_id)) }));
    },
  },
  {
    name: 'schedule_event',
    description: 'Add a calendar item (Shoot, Club Event, Post, Livestream, Meeting, Deadline) and schedule people on it. Times are San Antonio time, e.g. "2026-12-02 15:30". Scheduled people get notified.',
    inputSchema: { type: 'object', properties: {
      as: AS, type: { type: 'string', enum: ['Shoot', 'Club Event', 'Post', 'Livestream', 'Meeting', 'Deadline'] },
      title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, all_day: { type: 'boolean' },
      location: { type: 'string' }, notes: { type: 'string' }, people: { type: 'array', items: { type: 'string' } },
      request_number: { type: 'number', description: 'Link it to a request' },
    }, required: ['type', 'title', 'start'] },
    write: true,
    async run(ctx, a) {
      const row: Json = { type: a.type, title: a.title, starts_at: toISO(a.start), ends_at: a.end ? toISO(a.end) : null,
        all_day: !!a.all_day, location: a.location ?? null, notes: a.notes ?? null };
      if (a.request_number) row.request_id = (await getRequest(ctx, Number(a.request_number))).id;
      const { data, error } = await ctx.db.from('calendar_items').insert(row).select('id').single();
      if (error) throw error;
      const people = (a.people ?? []).map((w: string) => findPerson(ctx.team, w));
      if (people.length) {
        const { error: e2 } = await ctx.db.from('calendar_assignees').insert(people.map((p: Profile) => ({ item_id: data.id, user_id: p.id })));
        if (e2) throw e2;
      }
      await log(ctx, 'calendar.create', `${a.type} "${a.title}" ${fmtWhen(row.starts_at)}${people.length ? ` with ${people.map((p: Profile) => p.full_name).join(', ')}` : ''}`, { type: 'calendar', id: data.id });
      return { ok: true, scheduled: `${a.type}: ${a.title}`, when: fmtWhen(row.starts_at), people: people.map((p: Profile) => p.full_name) };
    },
  },
  {
    name: 'social_summary',
    description: 'Instagram + Facebook performance for the last N days: totals, top posts, and progress on posting goals.',
    inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'Default 30' } } },
    annotations: { readOnlyHint: true },
    async run(ctx, a) {
      const since = new Date(Date.now() - (Number(a.days) || 30) * 864e5).toISOString();
      const [{ data: posts, error }, { data: goals }] = await Promise.all([
        ctx.db.from('social_posts').select('platform, media_type, posted_at, caption, permalink, views, reach, likes, comments, shares, saves, interactions, pillar').gte('posted_at', since),
        ctx.db.from('content_goals').select('name, kind, platform, target, period').eq('active', true),
      ]);
      if (error) throw error;
      const ps = (posts ?? []) as Json[];
      if (!ps.length) return { note: 'No synced posts in that range (or you don’t have Insights access).' };
      const sum = (k: string) => ps.reduce((n, p) => n + (p[k] ?? 0), 0);
      return {
        days: Number(a.days) || 30, posts: ps.length,
        totals: { views: sum('views'), reach: sum('reach'), likes: sum('likes'), comments: sum('comments'), shares: sum('shares'), saves: sum('saves') },
        top_posts: [...ps].sort((x, y) => (y.views ?? 0) - (x.views ?? 0)).slice(0, 5).map((p) => ({ platform: p.platform, type: p.media_type,
          date: fmtWhen(p.posted_at), views: p.views, reach: p.reach, pillar: p.pillar, caption: (p.caption ?? '').slice(0, 120), link: p.permalink })),
        goals: goals ?? [],
      };
    },
  },
];

// ---------- auth ----------------------------------------------------------------
let claudeSession: { token: string; exp: number } | null = null;
async function claudeClient(admin: SupabaseClient) {
  if (!claudeSession || claudeSession.exp < Date.now() + 60_000) {
    const password = Deno.env.get('CLAUDE_ACCOUNT_PASSWORD');
    if (!password) throw new Error('The Claude account isn’t set up yet (CLAUDE_ACCOUNT_PASSWORD secret missing).');
    const { data: p } = await admin.from('profiles').select('username').eq('role', 'claude').eq('active', true).maybeSingle();
    if (!p) throw new Error('There is no active Claude account in Admin → People.');
    const c = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
    const { data, error } = await c.auth.signInWithPassword({ email: `${p.username}@${LOGIN_DOMAIN}`, password });
    if (error || !data.session) throw new Error(`Couldn't sign in as the Claude account: ${error?.message}`);
    claudeSession = { token: data.session.access_token, exp: (data.session.expires_at ?? 0) * 1000 };
  }
  return createClient(SUPABASE_URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${claudeSession.token}` } } });
}

const unauthorized = (msg = 'Sign in required') => json({ error: 'invalid_token', error_description: msg }, 401, {
  'WWW-Authenticate': `Bearer realm="mcp", resource_metadata="${RESOURCE}/.well-known/oauth-protected-resource"`,
});

// ---------- MCP JSON-RPC ----------------------------------------------------------
const INSTRUCTIONS = `You are connected to Picklr Media Hub, the media department's tool at The Picklr Live Oak (a pickleball club in San Antonio, TX; times are America/Chicago).
Requests flow: New → In Strategy (Strategy team writes the hook/brief/script into the request's brief) → approve_request → Ready for Execution → In Production → Scheduled → Posted.
Call get_overview first. Use get_options for valid pillars and types. You act as the signed-in person by default; pass as:"claude" only when they ask you to act as the Claude account.
Write scripts into the request's brief (update_request with brief_mode "append" unless asked to replace). Reusable scripts, hooks, shot lists, captions and templates live in the Library (list_library / save_library_doc); check it for past examples before drafting, and save good drafts there when asked. Before sending chats on someone's behalf, confirm the wording unless they told you exactly what to send.`;

async function handle(msg: Json, ctx: Ctx): Promise<Json | null> {
  const { id, method, params } = msg;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return null; // notification: no reply

  switch (method) {
    case 'initialize': {
      const v = PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[1];
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'picklr-media-hub', title: 'Picklr Media Hub', version: '1.0.0' }, instructions: INSTRUCTIONS });
    }
    case 'ping': return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema,
        annotations: t.annotations ?? { readOnlyHint: false, destructiveHint: false } })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool ${params?.name}`);
      const args = (params?.arguments ?? {}) as Json;
      try {
        let c = ctx;
        if (args.as === 'claude') {
          if (ctx.me.role !== 'admin') throw new Error('Only the admin can ask Claude to act as the Claude account.');
          c = { ...ctx, db: await claudeClient(ctx.admin), asClaude: true };
        }
        const out = await tool.run(c, args);
        return ok({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }
    default: return fail(-32601, `Method not found: ${method}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const path = new URL(req.url).pathname;

  // OAuth discovery (RFC 9728): tells Claude to sign in with Supabase Auth
  if (path.endsWith('/.well-known/oauth-protected-resource')) {
    return json({ resource: RESOURCE, authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ['header'], resource_name: 'Picklr Media Hub' });
  }
  if (req.method === 'GET' || req.method === 'DELETE') return new Response(null, { status: 405, headers: { ...cors, Allow: 'POST' } });

  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return unauthorized();
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const { data: u, error } = await admin.auth.getUser(token);
  if (error || !u.user) return unauthorized('Token expired or invalid');

  const { data: team } = await admin.from('profiles').select('id, username, full_name, role, active, permissions, is_service_account');
  const me = (team ?? []).find((p: Profile) => p.id === u.user.id) as Profile | undefined;
  if (!me?.active) return unauthorized('Account not active');
  if (me.role !== 'admin' && !me.permissions.includes('claude.connect')) {
    return json({ error: 'forbidden', error_description: 'Ask the admin for the "Use Claude as an assistant" permission.' }, 403);
  }
  const db = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const ctx: Ctx = { db, me, asClaude: false, admin, team: (team ?? []) as Profile[] };

  let body: unknown;
  try { body = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, ctx)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: cors });
  }
  const out = await handle(body as Json, ctx);
  return out ? json(out) : new Response(null, { status: 202, headers: cors });
});
