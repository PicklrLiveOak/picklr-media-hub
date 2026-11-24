// One request: workflow controls (media team), brief/script, details, files and Drive links.
// The comment thread is added in step 2 (chat).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { PRIORITIES, SECTIONS, STATUSES } from '../lib/constants';
import { fmtDate, fmtDateTime } from '../lib/format';
import { ACCEPT, prepareFile, signedUrl, uploadFile } from '../lib/upload';
import type { MediaRequest, RequestFile } from '../lib/types';
import { Avatar, ErrorNote, Field, StatusChip } from '../components/ui';
import LinksEditor, { cleanLinks } from '../components/LinksEditor';
import ChatThread from '../components/ChatThread';
import MuteButton from '../components/MuteButton';
import CalendarItemForm from '../components/CalendarItemForm';
import type { CalendarItem } from '../lib/types';
import { CALENDAR_STYLE } from '../lib/constants';

/** The request's comment thread (created the first time someone opens it). */
function RequestComments({ requestId }: { requestId: string }) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    supabase.rpc('request_chat', { rid: requestId }).then(({ data, error }) =>
      error ? setError(error.message) : setChatId(data as string));
  }, [requestId]);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!chatId) return <p className="text-sm text-stone-500">Loading comments…</p>;
  return (
    <>
      <div className="flex justify-end -mt-1 mb-1"><MuteButton chatId={chatId} className="!py-1 !px-2.5 !text-xs" /></div>
      <ChatThread chatId={chatId} allowInternal compact />
    </>
  );
}

export default function RequestDetail() {
  const { number } = useParams();
  const { me, can, team, departments, person, deptName, pillars, requestTypes } = useAuth();
  const nav = useNavigate();
  const [r, setR] = useState<MediaRequest | null>(null);
  const [draft, setDraft] = useState<MediaRequest | null>(null); // unsaved edits
  const [files, setFiles] = useState<RequestFile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [events, setEvents] = useState<CalendarItem[]>([]);
  const [scheduling, setScheduling] = useState<CalendarItem | 'new' | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('requests').select('*, request_assignees(user_id)')
      .eq('number', Number(number)).maybeSingle();
    if (!data) { setNotFound(true); return; }
    setR(data as MediaRequest); setDraft(data as MediaRequest);
    const { data: f } = await supabase.from('request_files').select('*').eq('request_id', data.id).order('created_at');
    setFiles((f as RequestFile[]) ?? []);
    const { data: ev } = await supabase.from('calendar_items').select('*, calendar_assignees(user_id)')
      .eq('request_id', data.id).order('starts_at');
    setEvents((ev as CalendarItem[]) ?? []);
  }, [number]);

  useEffect(() => { load(); }, [load]);

  if (notFound) return (
    <div className="space-y-2">
      <p>Request not found, or you don't have access to it.</p>
      <p className="text-sm text-stone-500">If it was just moved to the other team's stage, it now lives with that team.</p>
      <Link to="/" className="text-blue underline text-sm">← Home</Link>
    </div>
  );
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
      title: draft!.title, type: draft!.type, department_label: draft!.department_label?.trim() || null,
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
  const inStrategy = ['New', 'In Strategy', 'On Hold'].includes(r.status);
  const canApprove = inStrategy && (can('team.strategy') || me.role === 'admin');
  const canSchedule = can('calendar.edit');

  async function approve() {
    if (!r!.brief && !confirm('There is no brief/script yet. Approve anyway?')) return;
    setError(''); setBusy('Approving…');
    const { error } = await supabase.rpc('approve_request', { rid: r!.id });
    setBusy('');
    if (error) { setError(error.message); return; }
    // Strategy-only people no longer see it once it's handed to Execution
    const { data: still } = await supabase.from('requests').select('id').eq('id', r!.id).maybeSingle();
    if (still) load();
    else { alert(`#${r!.number} approved and sent to the Execution team.`); nav('/'); }
  }

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

      {/* Strategy → Execution pipeline */}
      <WorkflowSteps status={r.status} />
      {(canApprove || canSchedule) && (
        <section className="card p-4 space-y-3 border-blue">
          {canApprove && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <b>Strategy:</b> edit details, write the brief/script and attach files, then send it to Execution.
              </div>
              <button className="btn btn-primary" disabled={!!busy} onClick={approve}>✓ Approve → Execution</button>
            </div>
          )}
          {canSchedule && !inStrategy && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm"><b>Execution:</b> schedule the shoot and the people filming with you.</div>
              <button className="btn btn-dark" onClick={() => setScheduling('new')}>📅 Schedule</button>
            </div>
          )}
          {events.length > 0 && (
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${CALENDAR_STYLE[e.type] ?? ''}`}>{e.type}</span>
                  <span className="flex-1 min-w-0 truncate">{e.title} · {fmtDateTime(e.starts_at)}</span>
                  <span className="flex -space-x-1.5">{(e.calendar_assignees ?? []).map((a) => <Avatar key={a.user_id} person={person(a.user_id)} size={20} />)}</span>
                  {canSchedule && <button className="text-blue underline text-xs" onClick={() => setScheduling(e)}>edit</button>}
                </li>
              ))}
            </ul>
          )}
          {scheduling && (
            <CalendarItemForm
              initial={scheduling === 'new'
                ? { type: 'Shoot', title: `Film: ${r.title}`, request_id: r.id, date: r.event_date ?? r.needed_by ?? undefined }
                : scheduling}
              onDone={(changed) => { setScheduling(null); if (changed) load(); }} />
          )}
        </section>
      )}

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
                {pillars.filter((p) => p.active || p.name === draft.pillar).map((p) => <option key={p.name}>{p.name}</option>)}
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
          <textarea className="input min-h-48 font-mono" placeholder="Hook, shot list, script, caption ideas…"
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
            <select className="input" {...input('type')}>{requestTypes.filter((t) => t.active || t.name === draft.type).map((t) => <option key={t.name}>{t.name}</option>)}</select>
          </Field>
          <Field label="Department">
            <input className="input" list="dept-suggestions" maxLength={80} {...input('department_label')} />
            <datalist id="dept-suggestions">
              {departments.map((d) => <option key={d.id} value={d.name} />)}
            </datalist>
          </Field>
          <Field label="Event / program"><input className="input" {...input('event_name')} /></Field>
          <Field label="Event date"><input className="input" type="date" {...input('event_date')} /></Field>
          <Field label="Needed by"><input className="input" type="date" {...input('needed_by')} /></Field>
          <Field label="Requested by"><input className="input" disabled value={requester?.full_name ?? ''} /></Field>
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
        <div className="sticky bottom-above-tabbar z-10 flex gap-2">
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

      <section className="card p-4">
        <h2 className="h-display text-lg mb-3">Comments</h2>
        <RequestComments requestId={r.id} />
      </section>

      <ErrorNote error={error} />
      {busy && !dirty && <p className="text-sm">{busy}</p>}

      {isAdmin && (
        <button className="text-sm text-red-600 underline" onClick={deleteRequest}>Delete request (admin)</button>
      )}
    </div>
  );
}

// Where this request is in the pipeline
const STEPS = [
  { label: 'Submitted', statuses: ['New'] },
  { label: 'Strategy', statuses: ['In Strategy'] },
  { label: 'Execution', statuses: ['Ready for Execution', 'In Production'] },
  { label: 'Scheduled', statuses: ['Scheduled'] },
  { label: 'Posted', statuses: ['Posted'] },
];
function WorkflowSteps({ status }: { status: string }) {
  if (status === 'On Hold') return <p className="text-sm font-semibold text-stone-600">⏸ On hold</p>;
  const at = STEPS.findIndex((s) => s.statuses.includes(status));
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[11px] font-semibold">
      {STEPS.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1">
          <span className={`rounded-full px-2 py-1 whitespace-nowrap ${i < at ? 'bg-emerald-100 text-emerald-800' : i === at ? 'bg-blue text-white' : 'bg-white border border-line text-stone-400'}`}>
            {i < at ? '✓ ' : ''}{s.label}
          </span>
          {i < STEPS.length - 1 && <span className="text-stone-300">›</span>}
        </li>
      ))}
    </ol>
  );
}
