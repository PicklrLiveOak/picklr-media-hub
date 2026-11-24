// One Library doc: read it, edit it, copy it, see old versions, and send it
// to a request's brief. /library/new creates one (optionally prefilled from a
// request: "Save to Library" on the request page).
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { LIBRARY_KINDS, LIBRARY_STYLE } from '../lib/constants';
import { fmtDateTime } from '../lib/format';
import type { DriveLink, LibraryDoc, LibraryVersion } from '../lib/types';
import LinksEditor, { cleanLinks } from '../components/LinksEditor';
import { ErrorNote, Field, Toast } from '../components/ui';

type Draft = Pick<LibraryDoc, 'title' | 'kind' | 'pillar' | 'body' | 'links'> & { tags: string; requestNumber: string };
type Prefill = Partial<Pick<LibraryDoc, 'title' | 'kind' | 'pillar' | 'body'>> & { requestNumber?: number };

// Fresh state for every doc (otherwise "new" → saved doc would stay in edit mode)
export default function LibraryDocRoute() {
  const { id } = useParams();
  return <LibraryDocPage key={id} />;
}

function LibraryDocPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const prefill = (useLocation().state ?? {}) as Prefill;
  const { me, can, pillars, person } = useAuth();
  const canEdit = can('library.edit');

  const [doc, setDoc] = useState<LibraryDoc | null>(null);
  const [reqNumber, setReqNumber] = useState<number | null>(null);
  const [editing, setEditing] = useState(isNew);
  const [d, setD] = useState<Draft>({
    title: prefill.title ?? '', kind: prefill.kind ?? 'Script', pillar: prefill.pillar ?? null, body: prefill.body ?? '',
    links: [], tags: '', requestNumber: prefill.requestNumber ? String(prefill.requestNumber) : '',
  });
  const [versions, setVersions] = useState<LibraryVersion[] | null>(null);
  const [viewing, setViewing] = useState<LibraryVersion | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [missing, setMissing] = useState(false);

  async function load() {
    const { data } = await supabase.from('library_docs').select('*').eq('id', id!).maybeSingle();
    if (!data) { setMissing(true); return; }
    const x = data as LibraryDoc;
    setDoc(x);
    let num: number | null = null;
    if (x.request_id) num = (await supabase.from('requests').select('number').eq('id', x.request_id).maybeSingle()).data?.number ?? null;
    setReqNumber(num);
    setD({ title: x.title, kind: x.kind, pillar: x.pillar, body: x.body, links: x.links ?? [], tags: x.tags.join(', '), requestNumber: num ? String(num) : '' });
    setVersions(null); setViewing(null);
  }
  useEffect(() => { if (!isNew) load(); }, [id]);

  async function save() {
    setError('');
    if (!d.title.trim()) { setError('Give it a title.'); return; }
    let request_id: string | null = null;
    if (d.requestNumber.trim()) {
      const { data } = await supabase.from('requests').select('id').eq('number', Number(d.requestNumber.replace('#', ''))).maybeSingle();
      if (!data) { setError(`Request #${d.requestNumber} not found (or you can't see it).`); return; }
      request_id = data.id;
    }
    const row = {
      title: d.title.trim(), kind: d.kind, pillar: d.pillar || null, body: d.body, links: cleanLinks(d.links as DriveLink[]),
      tags: [...new Set(d.tags.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))], request_id,
    };
    if (isNew) {
      const { data, error } = await supabase.from('library_docs').insert(row).select('id').single();
      if (error) { setError(error.message); return; }
      nav(`/library/${data.id}`, { replace: true });
    } else {
      const { error } = await supabase.from('library_docs').update(row).eq('id', id!);
      if (error) { setError(error.message); return; }
      setEditing(false); setMsg('Saved.'); load();
    }
  }

  async function patch(p: Partial<LibraryDoc>, ok: string) {
    const { error } = await supabase.from('library_docs').update(p).eq('id', id!);
    if (error) setError(error.message); else { setMsg(ok); load(); }
  }

  async function remove() {
    if (!confirm(`Delete "${doc!.title}" for good, including its old versions? (Archive keeps it instead.)`)) return;
    const { error } = await supabase.from('library_docs').delete().eq('id', id!);
    if (error) setError(error.message); else nav('/library');
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setMsg('Copied.'); } catch { setError('Copy was blocked. Select the text and copy it instead.'); }
  }

  async function sendToRequest() {
    const n = prompt('Add this to the brief of which request? (number)', reqNumber ? String(reqNumber) : '')?.replace('#', '').trim();
    if (!n) return;
    const { data: r } = await supabase.from('requests').select('id, number, brief').eq('number', Number(n)).maybeSingle();
    if (!r) { setError(`Request #${n} not found (or you can't see it).`); return; }
    const brief = r.brief ? `${r.brief}\n\n— ${doc!.title} —\n${doc!.body}` : doc!.body;
    const { error } = await supabase.from('requests').update({ brief }).eq('id', r.id);
    if (error) setError(error.message); else setMsg(`Added to #${r.number}'s brief.`);
  }

  async function showVersions() {
    const { data } = await supabase.from('library_versions').select('*').eq('doc_id', id!).order('saved_at', { ascending: false }).limit(50);
    setVersions((data as LibraryVersion[]) ?? []);
  }

  if (missing) return <p>This doc doesn't exist, or you don't have access to the Library. <Link to="/library" className="text-blue underline">Back</Link></p>;
  if (!isNew && !doc) return <p>Loading…</p>;
  const canDelete = !!doc && (me?.role === 'admin' || (canEdit && doc.created_by === me?.id));

  return (
    <div className="max-w-3xl space-y-4">
      <Link to="/library" className="text-sm text-blue underline">← Library</Link>

      {editing ? (
        <section className="card p-4 space-y-3">
          <Field label="Title"><input className="input" maxLength={200} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. Turkey Shootout hype reel" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              <select className="input" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>
                {LIBRARY_KINDS.map((k) => <option key={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Pillar">
              <select className="input" value={d.pillar ?? ''} onChange={(e) => setD({ ...d, pillar: e.target.value || null })}>
                <option value="">—</option>
                {pillars.filter((p) => p.active || p.name === d.pillar).map((p) => <option key={p.name}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Script / text">
            <textarea className="input font-mono text-[15px] min-h-[50vh] leading-relaxed" value={d.body}
              placeholder={'HOOK (0–3s): …\n\nSHOTS:\n1. …\n\nVO / ON-SCREEN TEXT:\n…\n\nCTA: …\n\nCAPTION: …'}
              onChange={(e) => setD({ ...d, body: e.target.value })} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Tags (comma separated)"><input className="input" value={d.tags} onChange={(e) => setD({ ...d, tags: e.target.value })} placeholder="reel, holiday, league" /></Field>
            <Field label="Linked request # (optional)"><input className="input" inputMode="numeric" value={d.requestNumber} onChange={(e) => setD({ ...d, requestNumber: e.target.value })} placeholder="e.g. 112" /></Field>
          </div>
          <Field label="Links (Drive folders, references, music)"><LinksEditor links={d.links} onChange={(links) => setD({ ...d, links })} /></Field>
          <ErrorNote error={error} />
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" onClick={save}>{isNew ? 'Save to Library' : 'Save'}</button>
            <button className="btn btn-ghost" onClick={() => (isNew ? nav(-1) : (setEditing(false), load()))}>Cancel</button>
          </div>
        </section>
      ) : doc && (
        <>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded px-1.5 py-0.5 font-bold ${LIBRARY_STYLE[doc.kind] ?? ''}`}>{doc.kind}</span>
              {doc.pillar && <span className="text-stone-600">{doc.pillar}</span>}
              {doc.pinned && <span>📌 Pinned</span>}
              {doc.archived && <span className="rounded bg-stone-200 px-1.5 py-0.5">Archived</span>}
              {reqNumber && <Link to={`/r/${reqNumber}`} className="text-blue underline">Request #{reqNumber}</Link>}
            </div>
            <h1 className="h-display text-3xl mt-1 break-words">{doc.title}</h1>
            <p className="text-xs text-stone-500">
              Edited {fmtDateTime(doc.updated_at)}{person(doc.updated_by) ? ` by ${person(doc.updated_by)!.full_name}` : ''}
              {person(doc.created_by) ? ` · created by ${person(doc.created_by)!.full_name}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {canEdit && <button className="btn btn-primary text-sm" onClick={() => setEditing(true)}>✏️ Edit</button>}
            <button className="btn btn-ghost text-sm" onClick={() => copy(doc.body)}>Copy text</button>
            {can('requests.manage') && <button className="btn btn-ghost text-sm" onClick={sendToRequest}>Add to a request's brief</button>}
            {canEdit && <button className="btn btn-ghost text-sm" onClick={() => patch({ pinned: !doc.pinned }, doc.pinned ? 'Unpinned.' : 'Pinned to the top.')}>{doc.pinned ? 'Unpin' : '📌 Pin'}</button>}
          </div>

          <section className="card p-4">
            {doc.body
              ? <pre className="whitespace-pre-wrap break-words font-mono text-[15px] leading-relaxed">{doc.body}</pre>
              : <p className="text-sm text-stone-500">No text yet.</p>}
          </section>

          {(doc.tags.length > 0 || doc.links.length > 0) && (
            <section className="card p-4 space-y-2 text-sm">
              {doc.tags.length > 0 && <div className="flex flex-wrap gap-1">{doc.tags.map((t) => <span key={t} className="bg-cream rounded px-1.5">#{t}</span>)}</div>}
              {doc.links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer" className="block text-blue underline break-all">{l.label || l.url}</a>)}
            </section>
          )}

          {/* Old versions */}
          <section className="card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm">Previous versions</h2>
              {versions === null && <button className="text-sm text-blue underline" onClick={showVersions}>Show</button>}
            </div>
            {versions?.length === 0 && <p className="text-xs text-stone-500">No earlier versions yet.</p>}
            {versions && versions.length > 0 && (
              <ul className="divide-y divide-line text-sm">
                {versions.map((v) => (
                  <li key={v.id} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{fmtDateTime(v.saved_at)}{person(v.saved_by) ? ` · ${person(v.saved_by)!.full_name}` : ''}</span>
                    <button className="text-blue underline shrink-0" onClick={() => setViewing(viewing?.id === v.id ? null : v)}>{viewing?.id === v.id ? 'Hide' : 'View'}</button>
                  </li>
                ))}
              </ul>
            )}
            {viewing && (
              <div className="rounded-lg bg-cream p-3 space-y-2">
                <div className="font-semibold text-sm">{viewing.title}</div>
                <pre className="whitespace-pre-wrap break-words font-mono text-sm max-h-80 overflow-y-auto">{viewing.body}</pre>
                {canEdit && <button className="btn btn-ghost text-sm" onClick={() => confirm('Restore this version? The current text is kept as a version too.') &&
                  patch({ title: viewing.title, body: viewing.body }, 'Restored.')}>Restore this version</button>}
              </div>
            )}
          </section>

          {canEdit && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <button className="btn btn-ghost text-sm" onClick={() => patch({ archived: !doc.archived }, doc.archived ? 'Restored from archive.' : 'Archived.')}>
                {doc.archived ? 'Unarchive' : 'Archive'}
              </button>
              {canDelete && <button className="btn btn-ghost text-sm text-red-600" onClick={remove}>Delete for good</button>}
            </div>
          )}
          <ErrorNote error={error} />
        </>
      )}
      <Toast msg={msg} onDone={() => setMsg('')} />
    </div>
  );
}
