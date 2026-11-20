// Loads synced Instagram/Facebook data and works out the numbers the
// Insights page and the report both show.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { PILLARS, TIMEZONE } from './constants';
import type { SocialAccount, SocialDaily, SocialPost } from './types';

export type RangeKey = '7d' | '30d' | '90d' | 'this-month' | 'last-month';
export const RANGES: [RangeKey, string][] = [
  ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['this-month', 'This month'], ['last-month', 'Last month'],
];
export type Platform = 'all' | 'instagram' | 'facebook';

// Weekly posting target
export const TARGET = { reels: 3, graphics: 2 };

const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

export function rangeDates(key: RangeKey): { from: string; to: string; label: string } {
  const now = new Date();
  const today = iso(now);
  const [y, m] = today.split('-').map(Number);
  if (key === 'this-month') return { from: `${today.slice(0, 7)}-01`, to: today, label: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  if (key === 'last-month') {
    const first = new Date(y, m - 2, 1), last = new Date(y, m - 1, 0);
    return { from: iso(first), to: iso(last), label: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }
  const days = key === '7d' ? 7 : key === '30d' ? 30 : 90;
  return { from: iso(new Date(now.getTime() - (days - 1) * 864e5)), to: today, label: RANGES.find((r) => r[0] === key)![1] };
}

export const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
export const interactionsOf = (p: SocialPost) =>
  p.interactions ?? sum([p.likes, p.comments, p.shares, p.saves, p.reposts]);
export const isReel = (p: SocialPost) => p.media_type === 'REEL' || p.media_type === 'VIDEO' || p.media_type?.includes('VIDEO');
export const isGraphic = (p: SocialPost) => !isReel(p) && p.media_type !== 'STORY';

/** Monday of the week (San Antonio time) as YYYY-MM-DD */
export function weekOf(ts: string) {
  const d = new Date(new Date(ts).toLocaleString('en-US', { timeZone: TIMEZONE }));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}

export function useInsights(range: RangeKey, platform: Platform) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [daily, setDaily] = useState<SocialDaily[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const { from, to, label } = rangeDates(range);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const a = await supabase.from('social_accounts').select('*');
      let pq = supabase.from('social_posts').select('*')
        .gte('posted_at', `${from}T00:00:00-06:00`).lte('posted_at', `${to}T23:59:59-06:00`)
        .order('posted_at', { ascending: false });
      // Daily rows: include the day before the range so follower change can be computed
      let dq = supabase.from('social_daily').select('*')
        .gte('day', iso(new Date(new Date(from).getTime() - 864e5))).lte('day', to).order('day');
      if (platform !== 'all') { pq = pq.eq('platform', platform); dq = dq.eq('platform', platform); }
      const [p, d] = await Promise.all([pq, dq]);
      setAccounts((a.data as SocialAccount[]) ?? []);
      setPosts((p.data as SocialPost[]) ?? []);
      setDaily((d.data as SocialDaily[]) ?? []);
      setLoading(false);
    })();
  }, [from, to, platform, tick]);

  // ---- Totals for posts published in the range ----
  const totals = {
    posts: posts.length,
    views: sum(posts.map((p) => p.views)),
    reach: sum(posts.map((p) => p.reach)),
    likes: sum(posts.map((p) => p.likes)),
    comments: sum(posts.map((p) => p.comments)),
    shares: sum(posts.map((p) => p.shares)),
    saves: sum(posts.map((p) => p.saves)),
    reposts: sum(posts.map((p) => p.reposts)),
    interactions: sum(posts.map(interactionsOf)),
  };
  const engagementRate = totals.reach ? totals.interactions / totals.reach : 0;

  // ---- Followers: latest vs first day in range, per platform ----
  const followers = (['instagram', 'facebook'] as const)
    .filter((pl) => platform === 'all' || platform === pl)
    .map((pl) => {
      const rows = daily.filter((d) => d.platform === pl && d.followers != null);
      const first = rows[0]?.followers ?? null;
      const last = rows.at(-1)?.followers ?? accounts.find((a) => a.platform === pl)?.followers ?? null;
      return { platform: pl, now: last, change: first != null && last != null ? last - first : null,
        series: rows.map((r) => ({ x: r.day, y: r.followers! })) };
    })
    .filter((f) => accounts.some((a) => a.platform === f.platform) || f.series.length);

  // ---- By pillar ----
  const byPillar = [...PILLARS, null].map((pillar) => {
    const ps = posts.filter((p) => p.pillar === pillar);
    const reach = sum(ps.map((p) => p.reach));
    const inter = sum(ps.map(interactionsOf));
    return {
      pillar: pillar ?? 'Untagged', posts: ps.length,
      avgViews: ps.length ? Math.round(sum(ps.map((p) => p.views)) / ps.length) : 0,
      avgReach: ps.length ? Math.round(reach / ps.length) : 0,
      interactions: inter, rate: reach ? inter / reach : 0,
    };
  }).filter((r) => r.posts > 0);

  // ---- Posting cadence per week vs target (Instagram is the target platform) ----
  const igPosts = posts.filter((p) => p.platform === 'instagram');
  const weeks = new Map<string, { reels: number; graphics: number }>();
  for (const p of igPosts) {
    const w = weekOf(p.posted_at);
    const row = weeks.get(w) ?? { reels: 0, graphics: 0 };
    if (isReel(p)) row.reels++; else if (isGraphic(p)) row.graphics++;
    weeks.set(w, row);
  }
  // Include empty weeks too
  for (let d = new Date(`${from}T12:00:00`); iso(d) <= to; d = new Date(d.getTime() + 7 * 864e5)) {
    const w = weekOf(d.toISOString());
    if (!weeks.has(w)) weeks.set(w, { reels: 0, graphics: 0 });
  }
  const cadence = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({ week, ...v, met: v.reels >= TARGET.reels && v.graphics >= TARGET.graphics }));

  const top = [...posts].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

  return {
    loading, accounts, posts, daily, totals, engagementRate, followers, byPillar, cadence, top,
    from, to, label, refresh: () => setTick((t) => t + 1),
  };
}

export const fmtN = (n: number | null | undefined) =>
  n == null ? '—' : n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString();
export const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
