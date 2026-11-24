// Library: the media team's shared shelf of scripts, hooks, shot lists,
// captions, templates and notes. Search, filter, pin favorites.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { LIBRARY_KINDS, LIBRARY_STYLE } from '../lib/constants';
import { fmtDateTime } from '../lib/format';
import type { LibraryDoc } from '../lib/types';
import { PageHeader } from '../components/ui';

export default function Library() {
  const { can, pillars, pillarColor, person } = useAuth();
  const [docs, setDocs] = useState<LibraryDoc[] | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [pillar, setPillar] = useState('');
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    supabase.from('library_docs').select('*').eq('archived', archived)
      .order('pinned', { ascending: false }).order('updated_at', { ascending: false })
      .then(({ data }) => setDocs((data as LibraryDoc[]) ?? []));
  }, [archived]);

  const shown = useMemo(() => (docs ?? []).filter((d) => {
    const text = `${d.title} ${d.body} ${d.tags.join(' ')}`.toLowerCase();
    return (!kind || d.kind === kind) && (!pillar || d.pillar === pillar) && (!q || text.includes(q.toLowerCase()));
  }), [docs, q, kind, pillar]);

  return (
    <div className="space-y-4">
      <PageHeader title="Library" right={can('library.edit') && <Link to="/library/new" className="btn btn-primary text-sm">＋ New</Link>} />
      <p className="text-sm text-stone-600 -mt-3">Scripts, hooks, shot lists, captions and templates for videos. Every edit keeps the old version.</p>

      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
        <input className="input !py-1.5 !w-40 shrink-0" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !py-1.5 !w-auto shrink-0" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">All kinds</option>
          {LIBRARY_KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
        <select className="input !py-1.5 !w-auto shrink-0" value={pillar} onChange={(e) => setPillar(e.target.value)} aria-label="Pillar">
          <option value="">All pillars</option>
          {pillars.filter((p) => p.active).map((p) => <option key={p.name}>{p.name}</option>)}
        </select>
        <button className={`btn btn-ghost !py-1.5 text-sm shrink-0 ${archived ? '!bg-ink !text-cream' : ''}`} onClick={() => setArchived(!archived)}>
          {archived ? 'Showing archived' : 'Archived'}
        </button>
      </div>

      {docs === null ? <p className="text-sm text-stone-500">Loading…</p>
        : shown.length === 0 ? (
          <div className="card p-6 text-center text-sm text-stone-500">
            {docs.length === 0 && !archived
              ? <>Nothing here yet.{can('library.edit') && <> Tap <b>＋ New</b> to save your first script, or use <b>Save to Library</b> on a request's brief.</>}</>
              : 'No matches.'}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {shown.map((d) => (
              <Link key={d.id} to={`/library/${d.id}`} className="card p-3 space-y-1.5 hover:border-blue min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${LIBRARY_STYLE[d.kind] ?? ''}`}>{d.kind}</span>
                  {d.pinned && <span title="Pinned">📌</span>}
                  {d.pillar && <span className="flex items-center gap-1 text-xs text-stone-600 min-w-0 truncate">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: pillarColor(d.pillar) }} />{d.pillar}</span>}
                </div>
                <div className="font-bold leading-snug">{d.title}</div>
                {d.body && <p className="text-sm text-stone-600 line-clamp-3 whitespace-pre-line break-words">{d.body}</p>}
                {d.tags.length > 0 && <div className="flex flex-wrap gap-1">{d.tags.map((t) => <span key={t} className="text-[11px] bg-cream rounded px-1.5">#{t}</span>)}</div>}
                <div className="text-[11px] text-stone-500">Edited {fmtDateTime(d.updated_at)}{person(d.updated_by) ? ` by ${person(d.updated_by)!.full_name}` : ''}</div>
              </Link>
            ))}
          </div>
        )}
    </div>
  );
}
