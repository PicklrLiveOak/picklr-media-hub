// Board: kanban (swipe sideways on a phone, drag cards on a computer) or list view.
// Updates live when anyone changes a request.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { PILLARS, REQUEST_TYPES, STATUSES } from '../lib/constants';
import type { MediaRequest } from '../lib/types';
import RequestCard from '../components/RequestCard';
import { PageHeader } from '../components/ui';

type View = 'kanban' | 'list';
const VIEW_KEY = 'board.view';

export default function Board() {
  const { team, departments, can } = useAuth();
  const [rows, setRows] = useState<MediaRequest[]>([]);
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) as View) || 'kanban');
  const [filter, setFilter] = useState({ pillar: '', person: '', type: '', dept: '', section: '', q: '' });
  const [dragId, setDragId] = useState<string | null>(null);
  const canMove = can('requests.manage');

  const load = useCallback(async () => {
    const { data } = await supabase.from('requests').select('*, request_assignees(user_id)')
      .order('needed_by', { ascending: true, nullsFirst: false });
    setRows((data as MediaRequest[]) ?? []);
  }, []);

  useEffect(() => {
    load();
    // Realtime: refresh whenever a request is added or changed (RLS still applies).
    const ch = supabase.channel('board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode */ } }, [view]);

  const shown = useMemo(() => rows.filter((r) =>
    (!filter.pillar || r.pillar === filter.pillar) &&
    (!filter.type || r.type === filter.type) &&
    (!filter.dept || String(r.department_id) === filter.dept) &&
    (!filter.section || r.section === filter.section) &&
    (!filter.person || r.request_assignees?.some((a) => a.user_id === filter.person)) &&
    (!filter.q || `${r.title} ${r.event_name ?? ''} #${r.number}`.toLowerCase().includes(filter.q.toLowerCase())),
  ), [rows, filter]);

  async function moveTo(id: string, status: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r))); // instant feedback
    const { error } = await supabase.from('requests').update({ status }).eq('id', id);
    if (error) { alert(error.message); load(); }
  }

  const sel = (k: keyof typeof filter, label: string, options: [string, string][]) => (
    <select className="input !py-1.5 !w-auto shrink-0" value={filter[k]}
      onChange={(e) => setFilter({ ...filter, [k]: e.target.value })} aria-label={label}>
      <option value="">{label}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div>
      <PageHeader title="Board" right={
        <div className="flex items-center gap-2">
        <Link to="/new" className="btn btn-primary text-sm !py-1.5">＋ New</Link>
        <div className="flex rounded-lg overflow-hidden border border-line text-sm font-semibold">
          {(['kanban', 'list'] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 capitalize ${view === v ? 'bg-ink text-cream' : 'bg-white'}`}>{v}</button>
          ))}
        </div>
        </div>
      } />

      <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4">
        <input className="input !py-1.5 !w-36 shrink-0" placeholder="Search…" value={filter.q}
          onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        {sel('person', 'Anyone', team.filter((t) => t.active).map((t) => [t.id, t.full_name]))}
        {sel('pillar', 'All pillars', PILLARS.map((p) => [p, p]))}
        {sel('type', 'All types', REQUEST_TYPES.map((t) => [t, t]))}
        {sel('section', 'Both sections', [['Strategy', 'Strategy'], ['Execution', 'Execution']])}
        {sel('dept', 'All depts', departments.map((d) => [String(d.id), d.name]))}
      </div>

      {view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pb-4">
          {STATUSES.map((status) => {
            const items = shown.filter((r) => r.status === status);
            return (
              <section key={status}
                className="snap-start shrink-0 w-[82vw] sm:w-72 rounded-xl bg-white/50 border border-line p-2"
                onDragOver={(e) => canMove && e.preventDefault()}
                onDrop={() => { if (dragId) moveTo(dragId, status); setDragId(null); }}>
                <h2 className="flex justify-between items-center px-1 pb-2 text-sm font-bold">
                  {status} <span className="text-stone-500">{items.length}</span>
                </h2>
                <div className="space-y-2 min-h-16">
                  {items.map((r) => (
                    <div key={r.id} draggable={canMove} onDragStart={() => setDragId(r.id)}>
                      <RequestCard r={r} showStatus={false} />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.length === 0 && <p className="text-sm text-stone-500">Nothing matches.</p>}
          {shown.map((r) => <RequestCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  );
}
