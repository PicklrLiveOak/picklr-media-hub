// Admin → Setup: posting goals, plus content pillars and request categories.
// Pillars/categories: "Remove" hides an item from pickers but keeps it on
// existing requests and posts, so history never breaks.
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { ErrorNote } from '../components/ui';
import type { ContentGoal } from '../lib/types';

export const GOAL_KINDS: [ContentGoal['kind'], string][] = [
  ['reel', 'Reels & videos'], ['graphic', 'Graphics (photos + carousels)'], ['carousel', 'Carousels only'],
  ['story', 'Stories'], ['any', 'Any feed post (not stories)'],
];
const PLATFORMS: [ContentGoal['platform'], string][] = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['all', 'Both']];

type Row = { name: string; color?: string; sort: number; active: boolean };

export default function AdminSetup() {
  const { pillars, requestTypes, reload } = useAuth();
  return (
    <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
      <GoalsEditor />
      <ListEditor title="Content pillars" table="pillars" rows={pillars} withColor onChange={reload}
        hint="Tag requests and Instagram/Facebook posts. Colors show on the board and calendar." />
      <ListEditor title="Request categories" table="request_types" rows={requestTypes} onChange={reload}
        hint="The “Type” choices on the request form (Reel, Graphic…)." />
    </div>
  );
}

function ListEditor({ title, table, rows, withColor, hint, onChange }: {
  title: string; table: 'pillars' | 'request_types'; rows: Row[]; withColor?: boolean; hint: string; onChange: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0075E7');
  const [error, setError] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const active = rows.filter((r) => r.active);
  const removed = rows.filter((r) => !r.active);

  async function run(q: PromiseLike<{ error: { message: string } | null }>) {
    setError('');
    const { error } = await q;
    if (error) setError(error.message.includes('duplicate') ? 'That name already exists.' : error.message);
    await onChange();
    return !error;
  }

  async function add() {
    const n = name.trim();
    if (!n) return;
    const existing = rows.find((r) => r.name.toLowerCase() === n.toLowerCase());
    if (existing && !existing.active) {
      // Re-adding a removed one just restores it
      if (await run(supabase.from(table).update({ active: true }).eq('name', existing.name))) setName('');
      return;
    }
    const sort = Math.max(0, ...rows.map((r) => r.sort)) + 1;
    const row: Record<string, string | number> = withColor ? { name: n, color, sort } : { name: n, sort };
    if (await run(supabase.from(table).insert(row))) setName('');
  }

  async function rename(r: Row) {
    const n = prompt(`Rename "${r.name}" to:`, r.name)?.trim();
    if (!n || n === r.name) return;
    // ON UPDATE CASCADE renames it on every existing request/post too
    await run(supabase.from(table).update({ name: n }).eq('name', r.name));
  }

  async function move(r: Row, dir: -1 | 1) {
    const i = active.findIndex((x) => x.name === r.name);
    const other = active[i + dir];
    if (!other) return;
    await run(supabase.from(table).update({ sort: other.sort }).eq('name', r.name));
    await run(supabase.from(table).update({ sort: r.sort }).eq('name', other.name));
  }

  return (
    <section className="card p-4 space-y-3 min-w-0">
      <div>
        <h2 className="h-display text-lg">{title}</h2>
        <p className="text-xs text-stone-500">{hint}</p>
      </div>

      <ul className="divide-y divide-line">
        {active.map((r, i) => (
          <li key={r.name} className="flex items-center gap-2 py-2">
            {withColor && (
              <input type="color" value={r.color} aria-label={`Color for ${r.name}`}
                className="h-7 w-7 rounded border border-line shrink-0 cursor-pointer bg-white"
                onChange={(e) => run(supabase.from(table).update({ color: e.target.value }).eq('name', r.name))} />
            )}
            <span className="flex-1 min-w-0 truncate font-semibold">{r.name}</span>
            <button className="text-stone-400 px-0.5 shrink-0 disabled:opacity-20" disabled={i === 0} onClick={() => move(r, -1)} aria-label="Move up">▲</button>
            <button className="text-stone-400 px-0.5 shrink-0 disabled:opacity-20" disabled={i === active.length - 1} onClick={() => move(r, 1)} aria-label="Move down">▼</button>
            <button className="text-sm text-blue underline shrink-0" onClick={() => rename(r)}>Rename</button>
            <button className="text-sm text-red-600 underline shrink-0"
              onClick={() => confirm(`Remove "${r.name}"? It disappears from pickers but stays on existing items.`) &&
                run(supabase.from(table).update({ active: false }).eq('name', r.name))}>Remove</button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        {withColor && <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="New color"
          className="h-11 w-11 rounded-lg border border-line shrink-0 cursor-pointer bg-white" />}
        <input className="input" placeholder={`New ${withColor ? 'pillar' : 'category'}…`} maxLength={40}
          value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn btn-primary shrink-0" disabled={!name.trim()} onClick={add}>Add</button>
      </div>
      <ErrorNote error={error} />

      {removed.length > 0 && (
        <div className="text-sm">
          <button className="text-stone-500 underline" onClick={() => setShowRemoved(!showRemoved)}>
            {showRemoved ? 'Hide' : 'Show'} removed ({removed.length})
          </button>
          {showRemoved && (
            <ul className="mt-1">
              {removed.map((r) => (
                <li key={r.name} className="flex justify-between py-1 text-stone-500">
                  <span>{r.name}</span>
                  <button className="text-blue underline" onClick={() => run(supabase.from(table).update({ active: true }).eq('name', r.name))}>Restore</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function GoalsEditor() {
  const { goals, reload } = useAuth();
  const blank = { name: '', kind: 'reel' as ContentGoal['kind'], platform: 'instagram' as ContentGoal['platform'], target: 3, period: 'week' as ContentGoal['period'] };
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');

  async function run(q: PromiseLike<{ error: { message: string } | null }>) {
    setError('');
    const { error } = await q;
    if (error) setError(error.message);
    await reload();
    return !error;
  }
  const save = (g: ContentGoal, patch: Partial<ContentGoal>) => run(supabase.from('content_goals').update(patch).eq('id', g.id));

  async function add() {
    if (!f.name.trim() || !(f.target > 0)) return;
    const sort = Math.max(0, ...goals.map((g) => g.sort)) + 1;
    if (await run(supabase.from('content_goals').insert({ ...f, name: f.name.trim(), sort }))) setF(blank);
  }

  return (
    <section className="card p-4 space-y-3 min-w-0 md:col-span-2">
      <div>
        <h2 className="h-display text-lg">Posting goals</h2>
        <p className="text-xs text-stone-500">How many posts you aim for each week or month. Insights and the report track progress against these, counted from your synced Instagram/Facebook posts.</p>
      </div>

      {goals.length === 0 && <p className="text-sm text-stone-500">No goals yet. Add one below.</p>}
      <ul className="divide-y divide-line">
        {goals.map((g) => (
          <li key={g.id} className="py-2 flex flex-wrap items-center gap-2">
            <span className="font-semibold min-w-0 flex-1 basis-32 truncate">{g.name}</span>
            <input type="number" min={1} max={200} defaultValue={g.target} aria-label={`Target for ${g.name}`}
              className="input !w-20 !py-1.5" onBlur={(e) => { const n = Number(e.target.value); if (n > 0 && n !== g.target) save(g, { target: n }); }} />
            <select className="input !w-auto !py-1.5" value={g.period} aria-label="Per" onChange={(e) => save(g, { period: e.target.value as ContentGoal['period'] })}>
              <option value="week">per week</option><option value="month">per month</option>
            </select>
            <select className="input !w-auto !py-1.5" value={g.kind} aria-label="Counts" onChange={(e) => save(g, { kind: e.target.value as ContentGoal['kind'] })}>
              {GOAL_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select className="input !w-auto !py-1.5" value={g.platform} aria-label="Platform" onChange={(e) => save(g, { platform: e.target.value as ContentGoal['platform'] })}>
              {PLATFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className="text-sm text-blue underline" onClick={() => { const n = prompt('Rename goal:', g.name)?.trim(); if (n && n !== g.name) save(g, { name: n }); }}>Rename</button>
            <button className="text-sm text-red-600 underline"
              onClick={() => confirm(`Delete the "${g.name}" goal?`) && run(supabase.from('content_goals').delete().eq('id', g.id))}>Delete</button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2 items-center border-t border-line pt-3">
        <input className="input !w-auto flex-1 basis-40" placeholder="New goal (e.g. Stories)" maxLength={40}
          value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input type="number" min={1} max={200} className="input !w-20" aria-label="Target"
          value={f.target} onChange={(e) => setF({ ...f, target: Number(e.target.value) })} />
        <select className="input !w-auto" value={f.period} aria-label="Per" onChange={(e) => setF({ ...f, period: e.target.value as ContentGoal['period'] })}>
          <option value="week">per week</option><option value="month">per month</option>
        </select>
        <select className="input !w-auto" value={f.kind} aria-label="Counts" onChange={(e) => setF({ ...f, kind: e.target.value as ContentGoal['kind'] })}>
          {GOAL_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="input !w-auto" value={f.platform} aria-label="Platform" onChange={(e) => setF({ ...f, platform: e.target.value as ContentGoal['platform'] })}>
          {PLATFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="btn btn-primary" disabled={!f.name.trim() || !(f.target > 0)} onClick={add}>Add goal</button>
      </div>
      <p className="text-xs text-stone-500">Stories count from Instagram only. Meta only shares a story while it's live (24 hours), so the app checks for new stories every few hours.</p>
      <ErrorNote error={error} />
    </section>
  );
}
