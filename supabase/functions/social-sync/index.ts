// social-sync — pulls Instagram + Facebook analytics from Meta's Graph API.
//
// Actions (POST JSON):
//   { action: "connect", user_token, page_id? }  admin pastes a token from Meta's
//        Graph API Explorer; we swap it for a never-expiring Page token and store
//        it server-side. If several Pages come back, we return them to choose from.
//   { action: "sync" }       "Sync now" button (needs insights.manage)
//   { action: "cron" }       nightly run from pg_cron (no login; throttled)
//   { action: "disconnect" } forget the token (needs insights.manage)
//
// Secrets (Supabase → Edge Functions → Secrets): META_APP_ID, META_APP_SECRET
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v27.0';
const TZ = 'America/Chicago';
const POSTS_PER_SYNC = 50;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- Graph API helpers ------------------------------------------------
type Json = Record<string, any>;

async function graph(path: string, token: string, params: Record<string, string> = {}): Promise<Json> {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? 'Graph API error');
  return json;
}

/** Ask for several insight metrics at once; if Meta rejects the set
 *  (e.g. a metric was retired), fall back to asking one at a time. */
async function insights(objectId: string, token: string, metrics: string[], extra: Record<string, string> = {}) {
  const out: Record<string, number> = {};
  const read = (data: Json[]) => {
    for (const m of data ?? []) {
      const v = m.total_value?.value ?? m.values?.at(-1)?.value;
      if (typeof v === 'number') out[m.name] = v;
    }
  };
  try {
    read((await graph(`${objectId}/insights`, token, { metric: metrics.join(','), ...extra })).data);
  } catch {
    for (const metric of metrics) {
      try { read((await graph(`${objectId}/insights`, token, { metric, ...extra })).data); } catch { /* not available */ }
    }
  }
  return out;
}

/** Run async jobs a few at a time (keeps us inside Meta's rate limits). */
async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

const dayInTZ = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const nz = (n: unknown) => (typeof n === 'number' ? n : null);

// ---------- Sync -------------------------------------------------------------
async function syncInstagram(db: SupabaseClient, token: string, igId: string) {
  const acct = await graph(igId, token, { fields: 'username,followers_count,media_count' });
  const today = dayInTZ(new Date());
  const yesterday = dayInTZ(new Date(Date.now() - 864e5));

  // Account totals for yesterday (reach, views, interactions)
  const since = Math.floor(Date.now() / 1000) - 2 * 86400;
  const until = Math.floor(Date.now() / 1000) - 86400;
  const totals = await insights(igId, token, ['reach', 'views', 'total_interactions'],
    { period: 'day', metric_type: 'total_value', since: String(since), until: String(until) });

  await db.from('social_daily').upsert({ platform: 'instagram', day: today, followers: acct.followers_count });
  if (Object.keys(totals).length) {
    await db.from('social_daily').upsert({
      platform: 'instagram', day: yesterday,
      reach: nz(totals.reach), views: nz(totals.views), interactions: nz(totals.total_interactions),
    }, { onConflict: 'platform,day', ignoreDuplicates: false });
  }

  // Recent posts + per-post insights
  const media = await graph(`${igId}/media`, token, {
    fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
    limit: String(POSTS_PER_SYNC),
  });
  const rows: Json[] = [];
  await pool(media.data ?? [], 5, async (m: Json) => {
    const isReel = m.media_product_type === 'REELS';
    const metrics = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'reposts', 'total_interactions'];
    const ins = await insights(m.id, token, metrics);
    rows.push({
      id: `instagram:${m.id}`, platform: 'instagram', external_id: m.id, posted_at: m.timestamp,
      media_type: isReel ? 'REEL' : m.media_type === 'CAROUSEL_ALBUM' ? 'CAROUSEL' : m.media_type,
      caption: m.caption ?? null, permalink: m.permalink,
      thumbnail_url: m.thumbnail_url ?? (m.media_type === 'VIDEO' ? null : m.media_url) ?? null,
      views: nz(ins.views), reach: nz(ins.reach),
      likes: nz(ins.likes) ?? nz(m.like_count), comments: nz(ins.comments) ?? nz(m.comments_count),
      shares: nz(ins.shares), saves: nz(ins.saved), reposts: nz(ins.reposts),
      interactions: nz(ins.total_interactions), synced_at: new Date().toISOString(),
    });
  });
  if (rows.length) {
    const { error } = await db.from('social_posts').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
  await db.from('social_accounts').update({ username: acct.username, followers: acct.followers_count }).eq('platform', 'instagram');
  return rows.length;
}

async function syncFacebook(db: SupabaseClient, token: string, pageId: string) {
  const page = await graph(pageId, token, { fields: 'name,followers_count,fan_count' });
  const followers = page.followers_count ?? page.fan_count ?? null;
  const today = dayInTZ(new Date());
  const yesterday = dayInTZ(new Date(Date.now() - 864e5));

  const totals = await insights(pageId, token, ['page_media_view', 'page_total_media_view_unique', 'page_post_engagements'],
    { period: 'day', date_preset: 'yesterday' });
  await db.from('social_daily').upsert({ platform: 'facebook', day: today, followers });
  if (Object.keys(totals).length) {
    await db.from('social_daily').upsert({
      platform: 'facebook', day: yesterday,
      views: nz(totals.page_media_view), reach: nz(totals.page_total_media_view_unique),
      interactions: nz(totals.page_post_engagements),
    });
  }

  const posts = await graph(`${pageId}/posts`, token, {
    fields: 'id,created_time,message,permalink_url,full_picture,status_type,shares,' +
      'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)',
    limit: String(POSTS_PER_SYNC),
  });
  const rows: Json[] = [];
  await pool(posts.data ?? [], 5, async (p: Json) => {
    const ins = await insights(p.id, token, ['post_media_view', 'post_total_media_view_unique', 'post_video_views'],
      { period: 'lifetime' });
    const likes = nz(p.reactions?.summary?.total_count);
    const comments = nz(p.comments?.summary?.total_count);
    const shares = nz(p.shares?.count) ?? 0;
    rows.push({
      id: `facebook:${p.id}`, platform: 'facebook', external_id: p.id, posted_at: p.created_time,
      media_type: (p.status_type ?? 'POST').toUpperCase(), caption: p.message ?? null,
      permalink: p.permalink_url, thumbnail_url: p.full_picture ?? null,
      views: nz(ins.post_media_view) ?? nz(ins.post_video_views), reach: nz(ins.post_total_media_view_unique),
      likes, comments, shares, saves: null, reposts: null,
      interactions: (likes ?? 0) + (comments ?? 0) + shares, synced_at: new Date().toISOString(),
    });
  });
  if (rows.length) {
    const { error } = await db.from('social_posts').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
  await db.from('social_accounts').update({ name: page.name, followers }).eq('platform', 'facebook');
  return rows.length;
}

// ---------- Token health ------------------------------------------------------
// Asks Meta whether the stored token still works (debug_token) and saves the
// answer on social_accounts so Insights + Admin can show it.
const WARN_DAYS = 14;

async function checkToken(db: SupabaseClient, token: string) {
  const appId = Deno.env.get('META_APP_ID'), secret = Deno.env.get('META_APP_SECRET');
  let status: 'ok' | 'warning' | 'invalid' | 'unknown' = 'unknown';
  let message = 'Could not check the token';
  let expires: string | null = null;
  if (appId && secret) {
    try {
      const { data: d } = await graph('debug_token', `${appId}|${secret}`, { input_token: token });
      // 0 means "no expiry". Use the earliest real date of the two Meta reports.
      const dates = [d.expires_at, d.data_access_expires_at].filter((n: number) => n && n > 0) as number[];
      expires = dates.length ? new Date(Math.min(...dates) * 1000).toISOString() : null;
      if (!d.is_valid) {
        status = 'invalid';
        message = d.error?.message ?? 'Meta says this token is no longer valid';
      } else if (expires && Date.parse(expires) - Date.now() < WARN_DAYS * 864e5) {
        status = 'warning';
        message = `Token expires ${new Date(expires).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })} — reconnect before then`;
      } else {
        status = 'ok';
        message = expires ? `Valid until ${new Date(expires).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' })}` : 'Valid · never expires';
      }
    } catch (e) {
      message = `Token check failed: ${(e as Error).message}`;
    }
  }
  // Log only when the status changes, so the activity log isn't spammed nightly.
  const { data: prev } = await db.from('social_accounts').select('token_status').limit(1).maybeSingle();
  await db.from('social_accounts').update({
    token_status: status, token_message: message, token_checked_at: new Date().toISOString(), token_expires_at: expires,
  }).neq('platform', '');
  if (prev && prev.token_status !== status && (status === 'invalid' || status === 'warning' || prev.token_status !== 'unknown')) {
    await db.from('activity_log').insert({ source: 'system', action: `insights.token_${status}`, summary: `Meta token: ${message}` });
  }
  return { status, message };
}

async function runSync(db: SupabaseClient) {
  const { data: token } = await db.rpc('get_social_token');
  if (!token) return { ok: false, error: 'Not connected yet' };
  const health = await checkToken(db, token);
  if (health.status === 'invalid') {
    await db.from('social_accounts').update({ last_error: `Token stopped working — reconnect on the Insights page. (${health.message})` }).neq('platform', '');
    return { ok: false, error: health.message, token: health };
  }
  const { data: accounts } = await db.from('social_accounts').select('*');
  const result: Record<string, unknown> = {};
  for (const a of accounts ?? []) {
    try {
      const n = a.platform === 'instagram'
        ? await syncInstagram(db, token, a.external_id)
        : await syncFacebook(db, token, a.external_id);
      await db.from('social_accounts').update({ last_synced_at: new Date().toISOString(), last_error: null }).eq('platform', a.platform);
      result[a.platform] = `${n} posts updated`;
    } catch (e) {
      const msg = (e as Error).message;
      await db.from('social_accounts').update({ last_error: msg }).eq('platform', a.platform);
      result[a.platform] = `error: ${msg}`;
    }
  }
  await db.from('activity_log').insert({ source: 'system', action: 'insights.sync', summary: `Insights synced — ${JSON.stringify(result)}` });
  return { ok: true, result, token: health };
}

// ---------- Request handler -------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));

  // Nightly cron: no login, but never more than once every 30 minutes.
  if (body.action === 'cron') {
    const { data } = await db.from('social_accounts').select('last_synced_at');
    const last = Math.max(0, ...(data ?? []).map((a) => Date.parse(a.last_synced_at ?? '') || 0));
    if (Date.now() - last < 30 * 60_000) return reply({ skipped: 'synced recently' });
    return reply(await runSync(db));
  }

  // Everything else needs a signed-in user with insights.manage.
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: me } = await caller.auth.getUser();
  const { data: allowed } = await caller.rpc('has_perm', { p: 'insights.manage' });
  if (!me.user || !allowed) return reply({ error: 'You need "Upload insights / connect Instagram" permission.' }, 403);
  const log = (action: string, summary: string) =>
    db.from('activity_log').insert({ actor_id: me.user!.id, action, summary });

  try {
    if (body.action === 'connect') {
      const appId = Deno.env.get('META_APP_ID'), secret = Deno.env.get('META_APP_SECRET');
      if (!appId || !secret) throw new Error('META_APP_ID / META_APP_SECRET are not set in Supabase secrets yet.');
      // 1) Short-lived user token → long-lived user token (60 days)
      const long = await graph('oauth/access_token', String(body.user_token ?? '').trim(), {
        grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret,
        fb_exchange_token: String(body.user_token ?? '').trim(),
      });
      // 2) Pages this person manages. A Page token from a long-lived user token never expires.
      const pages = await graph('me/accounts', long.access_token, {
        fields: 'id,name,access_token,instagram_business_account{id,username}',
      });
      const list = (pages.data ?? []) as Json[];
      if (!list.length) throw new Error('No Facebook Pages found for this login. Make sure you picked the Page when granting access.');
      const page = body.page_id ? list.find((p) => p.id === body.page_id) : list.length === 1 ? list[0] : null;
      if (!page) {
        return reply({ choose: list.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram_business_account?.username ?? null })) });
      }
      await db.rpc('store_social_token', { p_token: page.access_token });
      await db.from('social_accounts').delete().neq('platform', '');
      await db.from('social_accounts').insert({ platform: 'facebook', external_id: page.id, name: page.name });
      if (page.instagram_business_account) {
        await db.from('social_accounts').insert({
          platform: 'instagram', external_id: page.instagram_business_account.id,
          username: page.instagram_business_account.username, name: page.instagram_business_account.username,
        });
      }
      await log('insights.connected', `Connected Facebook Page "${page.name}"${page.instagram_business_account ? ` + Instagram @${page.instagram_business_account.username}` : ' (no Instagram linked)'}`);
      return reply({ connected: true, page: page.name, instagram: page.instagram_business_account?.username ?? null, sync: await runSync(db) });
    }

    if (body.action === 'sync') {
      const { data } = await db.from('social_accounts').select('last_synced_at');
      const last = Math.max(0, ...(data ?? []).map((a) => Date.parse(a.last_synced_at ?? '') || 0));
      if (Date.now() - last < 2 * 60_000) return reply({ skipped: 'Synced less than 2 minutes ago' });
      return reply(await runSync(db));
    }

    if (body.action === 'check') {
      const { data: token } = await db.rpc('get_social_token');
      if (!token) return reply({ error: 'Not connected yet' }, 400);
      return reply({ token: await checkToken(db, token) });
    }

    if (body.action === 'disconnect') {
      await db.rpc('clear_social_token');
      await db.from('social_accounts').delete().neq('platform', '');
      await log('insights.disconnected', 'Disconnected Instagram/Facebook (history kept)');
      return reply({ disconnected: true });
    }

    return reply({ error: 'Unknown action' }, 400);
  } catch (e) {
    return reply({ error: (e as Error).message }, 400);
  }
});
