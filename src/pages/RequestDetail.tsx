// One request: workflow controls (media team), brief/script, details, files and Drive links.
// The comment thread is added in step 2 (chat).
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { PILLARS, PRIORITIES, REQUEST_TYPES, SECTIONS, STATUSES } from '../lib/constants';
import { fmtDate, fmtDateTime } from '../lib/format';
import { ACCEPT, prepareFile, signedUrl, uploadFile } from '../lib/upload';
import type { MediaRequest, RequestFile } from '../lib/types';
import { Avatar, ErrorNote, Field, StatusChip } from '../components/ui';
import LinksEditor, { cleanLinks } from '../components/LinksEditor';

export default function RequestDetail() {
  const { number } = useParams();
  const { me, can, team, departments, person, deptName } = useAuth();
  const nav = useNavigate();
  const [r, setR] = useState<MediaRequest | null>(null);
  const [draft, setDraft] = useState<MediaRequest | null>(null); // unsaved edits
  const [files, setFiles] = useState<RequestFile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('requests').select('*, request_assignees(user_id)')
      .eq('number', Number(number)).maybeSingle();
    if (!data) { setNotFound(true); return; }
    setR(data as MediaRequest); setDraft(data as MediaRequest);
    const { data: f } = await supabase.from('request_files').select('*').eq('request_id', data.id).order('created_at');
    setFiles((f as RequestFile[]) ?? []);
  }, [number]);

  useEffect(() => { load(); }, [load]);

  if (notFound) return <p>Request not found, or you don't have access to it.</p>;
  if (!r || !draft || !me) return <p>Loading…</p>;

  // What this person can do here (the database enforces the same rules).
  const isManager = can('requests.manage');
  const isOwner = r.requester_id === me.id || r.created_by === me.id;
  const canEdit = isManager || (isOwner && r.status === 'New');
  const isAdmin = me.role === 'admin';
  const dirty = JSON.stringify(draft) !== JSON.stringify(r);
  const assigneeIds = (r.request_assignees ?? []).map((a) => a.user_id);

  const setD = (patch: Partial<MediaRequest>) => setDraft({ ...draft, ...patch });
  const input = (k: keyof MediaRequest) => ({
    value: (draft[k] as string | null) ?? '',
    disabled: !canEdit,
    onChange: (e: { target: { value: string } }) => setD({ [k]: e.target.value || null } as Partial<MediaRequest>),
  });

  async function save() {
    setError(''); setBusy('Saving…');
    // Only send fields this person may change.
    const patch: Record<string, unknown> = {
      title: draft!.title, type: draft!.type, department_id: draft!.department_id || null,
      event_name: draft!.event_name, event_date: draft!.event_date, needed_by: draft!.needed_by,
      details: draft!.details, drive_links: cleanLinks(draft!.drive_links),
    };
    if (isManager) Object.assign(patch, {
      status: draft!.status, section: draft!.section, pillar: draft!.pillar,
      priority: draft!.priority, brief: draft!.brief,
    });
    const { error } = await supabase.from('requests').update(patch).eq('id', r!.id);
    if (error) setError(error.message);
    setBusy('');
    load();
  }

  async function toggleAssignee(userId: string) {
    const q = assigneeIds.includes(userId)
      ? supabase.from('request_assignees').delete().match({ request_id: r!.id, user_id: userId })
      : supabase.from('request_assignees').insert({ request_id: r!.id, user_id: userId });
    const { error } = await q;
    if (error) setError(error.message);
    load();
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError('');
    try {
      for (const [i, raw] of Array.from(list).entries()) {
        setBusy(`Uploading ${i + 1} of ${list.length}…`);
        const file = await prepareFile(raw);
        const path = await uploadFile(`requests/${r!.id}`, file);
        const { error } = await supabase.from('request_files').insert({
          request_id: r!.id, storage_path: path, file_name: file.name, mime: file.type, size_bytes: file.size,
        });
        if (error) throw error;
      }
    } catch (e) { setError((e as Error).message); }
    setBusy('');
    load();
  }

  async function removeFile(f: RequestFile) {
    if (!confirm(`Remove ${f.file_name}?`)) return;
    await supabase.storage.from('uploads').remove([f.storage_path]);
    const { error } = await supabase.from('request_files').delete().eq('id', f.id);
    if (error) setError(error.message);
    load();
  }

  async function openFile(f: RequestFile) {
    const url = await signedUrl(f.storage_path);
    if (url) window.open(url, '_blank');
  }

  async function deleteRequest() {
    if (!confirm(`Permanently delete request #${r!.number}? This cannot be undone.`)) return;
    if (files.length) await supabase.storage.from('uploads').remove(files.map((f) => f.storage_path));
    const { error } = await supabase.from('requests').delete().eq('id', r!.id);
    if (error) setError(error.message); else nav('/board');
  }

  const requester = person(r.requester_id);

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div>
        <div className="text-xs text-stone-500 font-semibold">
          #{r.number} · {r.type} · requested by {requester?.full_name ?? '—'} · {fmtDateTime(r.created_at)}
        </div>
        <h1 className="h-display text-3xl mt-1">{r.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <StatusChip status={r.status} />
          <span className="text-stone-600">{r.section}</span>
          {r.pillar && <span className="text-blue font-semibold">{r.pillar}</span>}
          {r.needed_by && <span>Due {fmtDate(r.needed_by)}</span>}
        </div>
      </div>

      {/* Workflow — media team only */}
      {isManager && (
        <section className="card p-4 space-y-3">
          <h2 className="h-display text-lg">Workflow</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select className="input" value={draft.status} onChange={(e) => setD({ status: e.target.value })}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Section">
              <select className="input" value={draft.section} onChange={(e) => setD({ section: e.target.value })}>
                {SECTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Pillar">
              <select className="input" value={draft.pillar ?? ''} onChange={(e) => setD({ pillar: e.target.value || null })}>
                <option value="">—</option>
                {PILLARS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" value={draft.priority} onChange={(e) => setD({ priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <div>
            <span className="label">Assignees (tap to add/remove — saves instantly)</span>
            <div className="flex flex-wrap gap-2">
              {team.filter((t) => t.active && (t.permissions.includes('requests.manage') || t.role === 'admin')).map((t) => {
                const on = assigneeIds.includes(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => toggleAssignee(t.id)}
                    className={`flex items-center gap-1.5 rounded-full border pl-1 pr-3 py-1 text-sm ${on ? 'bg-ink text-cream border-ink' : 'bg-white border-line'}`}>
                    <Avatar person={t} size={22} /> {t.full_name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Assignees, read-only for everyone else */}
      {!isManager && assigneeIds.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Working on it:</span>
          {assigneeIds.map((id) => <span key={id} className="flex items-center gap-1"><Avatar person={person(id)} size={22} />{person(id)?.full_name}</span>)}
        </div>
      )}

      {/* Brief / script */}
      <section className="card p-4">
        <h2 className="h-display text-lg mb-2">Brief / Script</h2>
        {isManager ? (
          <textarea className="input min-h-48 font-mono !text-sm" placeholder="Hook, shot list, script, caption ideas…"
            value={draft.brief ?? ''} onChange={(e) => setD({ brief: e.target.value || null })} />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{r.brief || <span className="text-stone-500">The media team hasn't written a brief yet.</span>}</p>
        )}
      </section>

      {/* Request details */}
      <section className="card p-4 space-y-3">
        <h2 className="h-display text-lg">Details</h2>
        {!canEdit && isOwner && <p className="text-xs text-stone-500">Details lock once the media team picks this up — add a comment instead.</p>}
        <Field label="Title"><input className="input" {...input('title')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className="input" {...input('type')}>{REQUEST_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </Field>
          <Field label="Department">
            <select className="input" disabled={!canEdit} value={draft.department_id ?? ''}
              onChange={(e) => setD({ department_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Event / program"><input className="input" {...input('event_name')} /></Field>
          <Field label="Event date"><input className="input" type="date" {...input('event_date')} /></Field>
          <Field label="Needed by"><input className="input" type="date" {...input('needed_by')} /></Field>
          <Field label="Requested by"><input className="input" disabled value={`${requester?.full_name ?? ''}${r.department_id ? ` (${deptName(r.department_id)})` : ''}`} /></Field>
        </div>
        <Field label="Details"><textarea className="input min-h-28" {...input('details')} /></Field>
        <div>
          <span className="label">Drive links (video, raw footage, big files)</span>
          {draft.drive_links.length === 0 && !canEdit && <p className="text-sm text-stone-500">None</p>}
          {canEdit ? (
            <LinksEditor links={draft.drive_links} onChange={(l) => setD({ drive_links: l })} />
          ) : (
            <ul className="text-sm space-y-1">
              {r.drive_links.map((l, i) => <li key={i}><a className="text-blue underline" href={l.url} target="_blank" rel="noreferrer">{l.label}</a></li>)}
            </ul>
          )}
        </div>
      </section>

      {/* Save bar appears when something changed */}
      {dirty && (
        <div className="sticky bottom-20 md:bottom-4 z-10 flex gap-2">
          <button className="btn btn-primary flex-1" onClick={save} disabled={!!busy}>{busy || 'Save changes'}</button>
          <button className="btn btn-ghost" onClick={() => setDraft(r)}>Cancel</button>
        </div>
      )}

      {/* Files */}
      <section className="card p-4">
        <h2 className="h-display text-lg mb-2">Files</h2>
        {files.length === 0 && <p className="text-sm text-stone-500 mb-2">No files yet.</p>}
        <ul className="space-y-1 mb-3">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
              <button className="text-blue underline truncate text-left" onClick={() => openFile(f)}>{f.file_name}</button>
              <span className="text-stone-500 shrink-0">{Math.round(f.size_bytes / 1024)} KB</span>
              {(isAdmin || (f.uploaded_by === me.id && canEdit)) && (
                <button className="text-red-600 shrink-0" onClick={() => removeFile(f)}>remove</button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <label className="btn btn-ghost text-sm cursor-pointer">
            ＋ Add images / PDFs
            <input type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          </label>
        )}
      </section>

      <section className="card p-4 text-sm text-stone-500">
        💬 Comments on this request arrive with Chat (step 2).
      </section>

      <ErrorNote error={error} />
      {busy && !dirty && <p className="text-sm">{busy}</p>}

      {isAdmin && (
        <button className="text-sm text-red-600 underline" onClick={deleteRequest}>Delete request (admin)</button>
      )}
    </div>
  );
}
