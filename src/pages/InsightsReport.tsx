// Printable social media report. "Save as PDF" from the print dialog, or
// copy the text summary into an email / Slack.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fmtN, fmtPct, interactionsOf, TARGET, useInsights, type Platform, type RangeKey } from '../lib/insights';

export default function InsightsReport() {
  const [params] = useSearchParams();
  const range = (params.get('range') as RangeKey) || '30d';
  const platform = (params.get('platform') as Platform) || 'all';
  const d = useInsights(range, platform);
  const [copied, setCopied] = useState(false);

  const weeksMet = d.cadence.filter((w) => w.met).length;
  const bestPillar = [...d.byPillar].filter((p) => p.pillar !== 'Untagged').sort((a, b) => b.avgViews - a.avgViews)[0];
  const best = d.top[0];
  const platformLabel = platform === 'all' ? 'Instagram + Facebook' : platform === 'instagram' ? 'Instagram' : 'Facebook';
  const dateSpan = `${new Date(`${d.from}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(`${d.to}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const highlights = [
    ...d.followers.map((f) => `${f.platform === 'instagram' ? 'Instagram' : 'Facebook'} followers: ${fmtN(f.now)}${f.change != null ? ` (${f.change >= 0 ? '+' : ''}${f.change})` : ''}`),
    `${d.totals.posts} posts reached ${fmtN(d.totals.reach)} accounts with ${fmtN(d.totals.views)} views`,
    `${fmtN(d.totals.interactions)} interactions — ${fmtPct(d.engagementRate)} engagement rate`,
    best ? `Top post: "${(best.caption ?? '').slice(0, 60)}${(best.caption ?? '').length > 60 ? '…' : ''}" — ${fmtN(best.views)} views` : null,
    bestPillar ? `Best pillar: ${bestPillar.pillar} (${fmtN(bestPillar.avgViews)} avg views)` : null,
    d.cadence.length ? `Posting target (${TARGET.reels} Reels + ${TARGET.graphics} graphics/week) met ${weeksMet} of ${d.cadence.length} weeks` : null,
  ].filter(Boolean) as string[];

  const text = `The Picklr Live Oak — Social Report (${platformLabel})\n${dateSpan}\n\n` + highlights.map((h) => `• ${h}`).join('\n');

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ }
  }

  if (d.loading) return <p>Building report…</p>;

  return (
    <div className="max-w-3xl mx-auto bg-white print:shadow-none card p-6 print:border-0 print:p-0 space-y-6">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Link to={`/insights?range=${range}&platform=${platform}`} className="btn btn-ghost text-sm">← Back</Link>
        <button className="btn btn-primary text-sm" onClick={() => window.print()}>🖨️ Print / Save as PDF</button>
        <button className="btn btn-ghost text-sm" onClick={copy}>{copied ? '✓ Copied' : '📋 Copy summary'}</button>
      </div>

      <header className="flex items-center gap-4 border-b border-line pb-4">
        <img src="picklr-mark.png" alt="" className="h-14 w-14" />
        <div>
          <h1 className="h-display text-3xl">Social Media Report</h1>
          <p className="text-sm text-stone-600">The Picklr Live Oak · {platformLabel} · {dateSpan}</p>
        </div>
      </header>

      <section>
        <h2 className="h-display text-xl mb-2">Highlights</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">{highlights.map((h) => <li key={h}>{h}</li>)}</ul>
      </section>

      <section>
        <h2 className="h-display text-xl mb-2">Totals</h2>
        <table className="w-full text-sm">
          <tbody>
            {([['Posts', d.totals.posts], ['Views', d.totals.views], ['Reach', d.totals.reach], ['Likes', d.totals.likes],
              ['Comments', d.totals.comments], ['Shares', d.totals.shares], ['Saves', d.totals.saves], ['Reposts', d.totals.reposts],
              ['Interactions', d.totals.interactions]] as [string, number][]).map(([k, v]) => (
              <tr key={k} className="border-t border-line"><td className="py-1">{k}</td><td className="text-right font-semibold">{v.toLocaleString()}</td></tr>
            ))}
            <tr className="border-t border-line"><td className="py-1">Engagement rate</td><td className="text-right font-semibold">{fmtPct(d.engagementRate)}</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="h-display text-xl mb-2">Top posts</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-stone-500"><th className="py-1">Post</th><th className="text-right">Views</th><th className="text-right">Reach</th><th className="text-right">Interactions</th></tr></thead>
          <tbody>
            {d.top.slice(0, 5).map((p) => (
              <tr key={p.id} className="border-t border-line align-top">
                <td className="py-1.5 pr-2">
                  <div className="text-[11px] text-stone-500">{p.platform === 'instagram' ? 'IG' : 'FB'} · {p.media_type} · {new Date(p.posted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{p.pillar ? ` · ${p.pillar}` : ''}</div>
                  <div className="line-clamp-2">{p.caption || '(no caption)'}</div>
                </td>
                <td className="text-right">{fmtN(p.views)}</td><td className="text-right">{fmtN(p.reach)}</td><td className="text-right">{fmtN(interactionsOf(p))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {d.byPillar.length > 0 && (
        <section>
          <h2 className="h-display text-xl mb-2">By content pillar</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-stone-500"><th className="py-1">Pillar</th><th className="text-right">Posts</th><th className="text-right">Avg views</th><th className="text-right">Eng. rate</th></tr></thead>
            <tbody>
              {d.byPillar.map((r) => (
                <tr key={r.pillar} className="border-t border-line"><td className="py-1">{r.pillar}</td><td className="text-right">{r.posts}</td><td className="text-right">{fmtN(r.avgViews)}</td><td className="text-right">{fmtPct(r.rate)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="h-display text-xl mb-2">Posting vs target</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-stone-500"><th className="py-1">Week of</th><th className="text-right">Reels</th><th className="text-right">Graphics</th><th className="text-right">Target</th></tr></thead>
          <tbody>
            {d.cadence.map((w) => (
              <tr key={w.week} className="border-t border-line">
                <td className="py-1">{new Date(`${w.week}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                <td className="text-right">{w.reels}/{TARGET.reels}</td><td className="text-right">{w.graphics}/{TARGET.graphics}</td>
                <td className="text-right">{w.met ? 'Met' : 'Short'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-[11px] text-stone-500">Generated {new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} by Picklr Media Hub. Post numbers are lifetime totals as of the last sync.</p>
    </div>
  );
}
