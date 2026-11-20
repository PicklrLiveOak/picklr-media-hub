// Insights: Instagram + Facebook performance, posting cadence, pillars,
// top posts — plus the Meta connection for admins.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { PILLARS } from '../lib/constants';
import { fmtDateTime } from '../lib/format';
import { RANGES, TARGET, fmtN, fmtPct, interactionsOf, useInsights, type Platform, type RangeKey } from '../lib/insights';
import type { SocialAccount, SocialPost } from '../lib/types';
import LineChart from '../components/LineChart';
import { ErrorNote, PageHeader } from '../components/ui';

export default function Insights() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const range = (params.get('range') as RangeKey) || '30d';
  const platform = (params.get('platform') as Platform) || 'all';
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p); };
  const d = useInsights(range, platform);
  const [sort, setSort] = useState<keyof SocialPost>('views');
  const connected = d.accounts.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Insights" right={
        <Link to={`/insights/report?range=${range}&platform=${platform}`} className="btn btn-dark text-sm">📄 Report</Link>
      } />

      <div className="flex flex-wrap gap-2">
        <select className="input !w-auto" value={range} onChange={(e) => set('range', e.target.value)}>
          {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="flex rounded-lg overflow-hidden border border-line text-sm font-semibold">
          {(['all', 'instagram', 'facebook'] as Platform[]).map((p) => (
            <button key={p} onClick={() => set('platform', p)}
              className={`px-3 py-2 capitalize ${platform === p ? 'bg-ink text-cream' : 'bg-white'}`}>{p}</button>
          ))}
        </div>
      </div>

      {can('insights.manage') && <Connection accounts={d.accounts} onChange={d.refresh} />}
      {!connected && !can('insights.manage') && (
        <p className="card p-4 text-sm">Instagram and Facebook aren't connected yet — Nehemiah will set that up.</p>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {d.followers.map((f) => (
          <Tile key={f.platform} label={`${f.platform === 'instagram' ? 'IG' : 'FB'} followers`} value={fmtN(f.now)}
            sub={f.change == null ? undefined : `${f.change >= 0 ? '+' : ''}${f.change.toLocaleString()} in range`} />
        ))}
        <Tile label="Posts" value={fmtN(d.totals.posts)} />
        <Tile label="Views" value={fmtN(d.totals.views)} />
        <Tile label="Reach" value={fmtN(d.totals.reach)} />
        <Tile label="Likes" value={fmtN(d.totals.likes)} />
        <Tile label="Comments" value={fmtN(d.totals.comments)} />
        <Tile label="Shares" value={fmtN(d.totals.shares)} />
        <Tile label="Saves" value={fmtN(d.totals.saves)} />
        <Tile label="Reposts" value={fmtN(d.totals.reposts)} />
        <Tile label="Engagement rate" value={fmtPct(d.engagementRate)} sub="interactions ÷ reach" />
      </div>
      <p className="text-xs text-stone-500 -mt-3">Totals cover posts published {d.label.toLowerCase()} · lifetime numbers as of the last sync.</p>

      {/* Follower trend — one small chart per platform (different scales) */}
      {d.followers.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {d.followers.map((f) => (
            <section key={f.platform} className="card p-4">
              <h2 className="h-display text-lg mb-2 capitalize">{f.platform} followers</h2>
              <LineChart data={f.series} label={`${f.platform} followers over time`} />
            </section>
          ))}
        </div>
      )}

      {/* Cadence vs target */}
      <section className="card p-4">
        <h2 className="h-display text-lg">Posting vs target</h2>
        <p className="text-xs text-stone-500 mb-2">Instagram, per week · target {TARGET.reels} Reels + {TARGET.graphics} graphics</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-stone-500"><th className="py-1 font-semibold">Week of</th><th>Reels</th><th>Graphics</th><th></th></tr></thead>
          <tbody>
            {d.cadence.map((w) => (
              <tr key={w.week} className="border-t border-line">
                <td className="py-1.5">{new Date(`${w.week}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                <td className={w.reels >= TARGET.reels ? '' : 'text-red-600'}>{w.reels}/{TARGET.reels}</td>
                <td className={w.graphics >= TARGET.graphics ? '' : 'text-red-600'}>{w.graphics}/{TARGET.graphics}</td>
                <td>{w.met ? '✅ Met' : '⚠️ Short'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* By pillar */}
      <section className="card p-4 overflow-x-auto">
        <h2 className="h-display text-lg mb-2">By content pillar</h2>
        {d.byPillar.length === 0 ? <p className="text-sm text-stone-500">No posts in this range.</p> : (
          <table className="w-full text-sm min-w-[480px]">
            <thead><tr className="text-left text-stone-500"><th className="py-1 font-semibold">Pillar</th><th>Posts</th><th>Avg views</th><th>Avg reach</th><th>Eng. rate</th></tr></thead>
            <tbody>
              {d.byPillar.map((r) => {
                const best = Math.max(...d.byPillar.map((x) => x.avgViews)) || 1;
                return (
                  <tr key={r.pillar} className="border-t border-line">
                    <td className="py-1.5 font-semibold">{r.pillar}</td>
                    <td>{r.posts}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-r bg-blue" style={{ width: `${(r.avgViews / best) * 70}px` }} />
                        {fmtN(r.avgViews)}
                      </div>
                    </td>
                    <td>{fmtN(r.avgReach)}</td>
                    <td>{fmtPct(r.rate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-xs text-stone-500 mt-2">Tag posts with a pillar below to fill this in.</p>
      </section>

      {/* Posts */}
      <section className="space-y-2">
        <div className="flex justify-between items-center">
          <h2 className="h-display text-lg">Posts</h2>
          <select className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as keyof SocialPost)} aria-label="Sort posts">
            <option value="views">Most views</option><option value="reach">Most reach</option><option value="likes">Most likes</option>
            <option value="shares">Most shares</option><option value="saves">Most saves</option><option value="posted_at">Newest</option>
          </select>
        </div>
        {d.posts.length === 0 && <p className="text-sm text-stone-500">{d.loading ? 'Loading…' : 'No posts in this range.'}</p>}
        {[...d.posts].sort((a, b) => sort === 'posted_at' ? b.posted_at.localeCompare(a.posted_at) : ((b[sort] as number) ?? 0) - ((a[sort] as number) ?? 0))
          .map((p) => <PostRow key={p.id} p={p} onTagged={d.refresh} />)}
      </section>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-[11px] text-stone-500">{sub}</div>}
    </div>
  );
}

function PostRow({ p, onTagged }: { p: SocialPost; onTagged: () => void }) {
  const { can } = useAuth();
  const canTag = can('insights.manage') || can('requests.manage');
  async function tag(pillar: string) {
    await supabase.from('social_posts').update({ pillar: pillar || null }).eq('id', p.id);
    onTagged();
  }
  const stats: [string, number | null][] = [['Views', p.views], ['Reach', p.reach], ['Likes', p.likes], ['Comments', p.comments],
    ['Shares', p.shares], ['Saves', p.saves], ['Reposts', p.reposts], ['Interactions', interactionsOf(p)]];
  return (
    <article className="card p-3 flex gap-3">
      <a href={p.permalink ?? '#'} target="_blank" rel="noreferrer" className="shrink-0">
        {p.thumbnail_url
          ? <img src={p.thumbnail_url} alt="" className="h-20 w-20 rounded-lg object-cover bg-stone-200" loading="lazy" />
          : <div className="h-20 w-20 rounded-lg bg-stone-200 grid place-items-center text-2xl">{p.platform === 'instagram' ? '📸' : '📘'}</div>}
      </a>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-stone-500 font-semibold">
          {p.platform === 'instagram' ? 'Instagram' : 'Facebook'} · {p.media_type} · {fmtDateTime(p.posted_at)}
        </div>
        <p className="text-sm line-clamp-2">{p.caption || <span className="text-stone-400">No caption</span>}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs mt-1">
          {stats.filter(([, v]) => v != null).map(([k, v]) => <span key={k}><b>{fmtN(v)}</b> {k.toLowerCase()}</span>)}
        </div>
        {canTag ? (
          <select className="input !py-1 !w-auto mt-1.5 !text-base" value={p.pillar ?? ''} onChange={(e) => tag(e.target.value)} aria-label="Pillar">
            <option value="">Tag pillar…</option>
            {PILLARS.map((x) => <option key={x}>{x}</option>)}
          </select>
        ) : p.pillar && <div className="text-xs text-blue mt-1">{p.pillar}</div>}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Admin: connect / sync / disconnect Meta
async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('social-sync', { body });
  if (error) {
    const msg = await error.context?.json?.().then((j: { error?: string }) => j.error).catch(() => null);
    throw new Error(msg || error.message);
  }
  return data;
}

function Connection({ accounts, onChange }: { accounts: SocialAccount[]; onChange: () => void }) {
  const [open, setOpen] = useState(accounts.length === 0);
  const [token, setToken] = useState('');
  const [pages, setPages] = useState<{ id: string; name: string; instagram: string | null }[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function run(label: string, body: Record<string, unknown>) {
    setBusy(label); setError(''); setMsg('');
    try {
      const res = await call(body);
      if (res.choose) setPages(res.choose);
      else if (res.connected) { setMsg(`Connected ${res.page}${res.instagram ? ` + @${res.instagram}` : ''}. First sync done.`); setToken(''); setPages([]); }
      else if (res.skipped) setMsg(res.skipped);
      else if (res.result) setMsg(`Synced: ${Object.entries(res.result).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
      else if (res.disconnected) setMsg('Disconnected. Past numbers are kept.');
      onChange();
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  }

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="h-display text-lg">Meta connection</h2>
          {accounts.length ? accounts.map((a) => (
            <div key={a.platform} className="text-xs">
              <b className="capitalize">{a.platform}</b> {a.username ? `@${a.username}` : a.name} ·{' '}
              <span className={a.last_error ? 'text-red-600' : 'text-stone-500'}>
                {a.last_error ? `error: ${a.last_error}` : a.last_synced_at ? `synced ${fmtDateTime(a.last_synced_at)}` : 'not synced'}
              </span>
            </div>
          )) : <p className="text-xs text-stone-500">Not connected. Syncs nightly at 2:15 AM once connected.</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          {accounts.length > 0 && <button className="btn btn-primary text-sm" disabled={!!busy} onClick={() => run('sync', { action: 'sync' })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>}
          <button className="btn btn-ghost text-sm" onClick={() => setOpen(!open)}>{open ? 'Close' : accounts.length ? 'Settings' : 'Connect'}</button>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <ol className="text-sm list-decimal pl-5 space-y-1 text-stone-700">
            <li>Open Meta's <a className="text-blue underline" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Graph API Explorer</a> and pick the Picklr Media Hub app.</li>
            <li>Add permissions: <code className="text-xs">pages_show_list, pages_read_engagement, read_insights, instagram_basic, instagram_manage_insights, business_management, ads_read, ads_management</code>. (The two ads ones are needed when the Page is shared to you through Business Manager — the app only reads, it never touches ads.)</li>
            <li>Click <b>Generate Access Token</b>, choose The Picklr Live Oak Page + Instagram, then copy the token here.</li>
          </ol>
          <textarea className="input font-mono min-h-20" placeholder="Paste the access token" value={token}
            onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
          {pages.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-semibold">Which Page?</p>
              {pages.map((p) => (
                <button key={p.id} className="btn btn-ghost w-full justify-start text-sm" onClick={() => run('connect', { action: 'connect', user_token: token, page_id: p.id })}>
                  {p.name} {p.instagram ? `· @${p.instagram}` : '· (no Instagram linked)'}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" disabled={!token.trim() || !!busy} onClick={() => run('connect', { action: 'connect', user_token: token })}>
              {busy === 'connect' ? 'Connecting…' : 'Connect'}
            </button>
            {accounts.length > 0 && (
              <button className="btn btn-ghost text-red-600" disabled={!!busy}
                onClick={() => confirm('Disconnect Instagram/Facebook? Past numbers are kept.') && run('disconnect', { action: 'disconnect' })}>Disconnect</button>
            )}
          </div>
        </div>
      )}
      <ErrorNote error={error} />
      {msg && <p className="text-sm text-emerald-700 mt-2">{msg}</p>}
    </section>
  );
}
