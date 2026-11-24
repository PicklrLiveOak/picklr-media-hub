// push-send — sends phone/computer push notifications (Web Push, no email).
//
// Called with POST JSON:
//   { type: "notification", id }  from a database trigger when a notification row is added
//   { type: "message", id }       from a database trigger when a chat message is sent
//   { action: "test" }            "Send me a test" button (needs a signed-in user)
//
// The triggers only pass an id. This function looks the row up itself and
// marks it pushed first, so a forged call can't invent a message or repeat one.
//
// Each person's settings live in profiles.notify_prefs (missing key = on).
// Secret (Supabase → Edge Functions → Secrets): VAPID_KEYS (JSON key pair)
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

const APP_URL = 'https://picklrliveoak.github.io/picklr-media-hub/';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Payload = { title: string; body: string; url: string; tag?: string; icon?: string };
type Profile = { id: string; role: string; active: boolean; permissions: string[]; notify_prefs: Record<string, boolean> };

let appServer: webpush.ApplicationServer | null = null;
async function server() {
  if (!appServer) {
    const raw = Deno.env.get('VAPID_KEYS');
    if (!raw) throw new Error('VAPID_KEYS secret is not set');
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(raw), { extractable: false });
    // Push services want contact info; a URL keeps personal email out of it.
    appServer = await webpush.ApplicationServer.new({ contactInformation: APP_URL, vapidKeys });
  }
  return appServer;
}

const wants = (p: Profile, key: string) => p.active && p.notify_prefs?.[key] !== false;

/** Send one payload to every device of these people. Returns how many went out. */
async function sendTo(db: SupabaseClient, userIds: string[], payload: Payload) {
  if (!userIds.length) return 0;
  const { data: subs } = await db.from('push_subscriptions').select('*').in('user_id', userIds);
  const app = await server();
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await app.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })
        .pushTextMessage(JSON.stringify(payload), { ttl: 86400, urgency: webpush.Urgency.High, topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) });
      sent++;
      await db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e) {
      // 404/410 = the phone unsubscribed or the app was removed: forget it
      const status = (e as { response?: Response }).response?.status;
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      else console.error('push failed', status, (e as Error).message);
    }
  }));
  return sent;
}

/** The sender's profile photo for chat pushes (a 7-day link). null = app logo. */
async function photoOf(db: SupabaseClient, userId: string | null) {
  if (!userId) return undefined;
  const { data: p } = await db.from('profiles').select('avatar_path').eq('id', userId).maybeSingle();
  if (!p?.avatar_path) return undefined;
  const { data } = await db.storage.from('uploads').createSignedUrl(p.avatar_path, 7 * 86400);
  return data?.signedUrl;
}

async function profiles(db: SupabaseClient, ids: string[]) {
  if (!ids.length) return [] as Profile[];
  const { data } = await db.from('profiles').select('id, role, active, permissions, notify_prefs').in('id', ids);
  return (data ?? []) as Profile[];
}

// A notification row (new request, approval, status change, schedule, @mention)
async function pushNotification(db: SupabaseClient, id: number) {
  const { data: n } = await db.from('notifications').update({ pushed_at: new Date().toISOString() })
    .eq('id', id).is('pushed_at', null).select('*').maybeSingle();
  if (!n) return 0; // already sent, or doesn't exist
  const [p] = await profiles(db, [n.user_id]);
  if (!p || !wants(p, n.kind)) return 0;
  // Chat-type alerts show the sender's photo; everything else keeps the Picklr logo
  const icon = n.kind.startsWith('chat.') ? await photoOf(db, n.actor_id) : undefined;
  return sendTo(db, [p.id], { title: n.title, body: n.body ?? '', url: n.link ?? '/', tag: `${n.kind}-${n.id}`, icon });
}

// A chat message → everyone else in that chat who wants that kind of chat
async function pushMessage(db: SupabaseClient, id: string) {
  const { data: m } = await db.from('messages').update({ pushed_at: new Date().toISOString() })
    .eq('id', id).is('pushed_at', null).select('*').maybeSingle();
  if (!m) return 0;
  const { data: chat } = await db.from('chats').select('id, kind, name, is_default, request_id').eq('id', m.chat_id).single();
  const { data: members } = await db.from('chat_members').select('user_id, muted').eq('chat_id', m.chat_id);
  const { data: author } = await db.from('profiles').select('full_name').eq('id', m.author_id).single();
  let number: number | null = null;
  // Request comments go to the people on that request (requester, assignees,
  // anyone who has commented), not everyone who once opened it.
  let onRequest: Set<string> | null = null;
  if (chat.request_id) {
    const { data: r } = await db.from('requests').select('number, requester_id, created_by, request_assignees(user_id)').eq('id', chat.request_id).single();
    number = r?.number ?? null;
    const { data: authors } = await db.from('messages').select('author_id').eq('chat_id', m.chat_id).neq('id', m.id);
    onRequest = new Set([r?.requester_id, r?.created_by, ...(r?.request_assignees ?? []).map((a: { user_id: string }) => a.user_id),
      ...(authors ?? []).map((a) => a.author_id)].filter(Boolean));
  }
  const muted = new Set((members ?? []).filter((x) => x.muted).map((x) => x.user_id));

  const pref = chat.kind === 'request' ? 'chat.request' : chat.is_default ? 'chat.general' : 'chat.message';
  const mentioned = new Set<string>(m.mentions ?? []); // they get the @mention push instead
  const people = (await profiles(db, (members ?? []).map((x) => x.user_id)))
    .filter((p) => p.id !== m.author_id && !mentioned.has(p.id) && !muted.has(p.id) && wants(p, pref))
    .filter((p) => !onRequest || onRequest.has(p.id))
    .filter((p) => !m.internal || p.role === 'admin' || p.permissions.includes('requests.internal'))
    .filter((p) => chat.kind === 'request' || p.role === 'admin' || p.permissions.includes('section.chat'));

  const who = author?.full_name ?? 'Someone';
  const title = chat.kind === 'dm' ? who : chat.kind === 'request' ? `${who} on #${number}` : `${who} in ${chat.name}`;
  const body = m.body ? m.body.slice(0, 180) : m.attachment_path ? '📷 Photo' : (m.link_url ?? '');
  const url = chat.kind === 'request' && number ? `/r/${number}` : `/chat/${chat.id}`;
  return sendTo(db, people.map((p) => p.id), { title, body, url, tag: `chat-${chat.id}`, icon: await photoOf(db, m.author_id) });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.type === 'notification' && Number.isInteger(body.id)) return reply({ sent: await pushNotification(db, body.id) });
    if (body.type === 'message' && typeof body.id === 'string') return reply({ sent: await pushMessage(db, body.id) });

    if (body.action === 'test') {
      const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      });
      const { data } = await caller.auth.getUser();
      if (!data.user) return reply({ error: 'Sign in first' }, 401);
      const sent = await sendTo(db, [data.user.id], {
        title: 'Notifications are on ✅', body: 'This is how Media Hub alerts will look.', url: '/me', tag: 'test',
      });
      return reply({ sent });
    }
    return reply({ error: 'Unknown request' }, 400);
  } catch (e) {
    console.error(e);
    return reply({ error: (e as Error).message }, 500);
  }
});
