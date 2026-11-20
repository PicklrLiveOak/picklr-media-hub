// Create / edit a calendar item (shoot, post, meeting…). Used by the Calendar
// page and by "Schedule" on a request. Times are entered in local time
// (everyone is in San Antonio).
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { CALENDAR_TYPES, POST_STATUSES } from '../lib/constants';
import type { CalendarItem } from '../lib/types';
import MemberPicker from './MemberPicker';
import { ErrorNote, Field } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export type CalendarDraft = Partial<CalendarItem> & { date?: string };

export default function CalendarItemForm({ initial, onDone }: { initial: CalendarDraft; onDone: (changed: boolean) => void }) {
  const { me } = useAuth();
  const start = initial.starts_at ? new Date(initial.starts_at) : null;
  const end = initial.ends_at ? new Date(initial.ends_at) : null;
  const [f, setF] = useState({
    type: initial.type ?? 'Shoot',
    title: initial.title ?? '',
    date: initial.date ?? (start ? localDate(start) : localDate(new Date())),
    start: start ? localTime(start) : '10:00',
    end: end ? localTime(end) : '11:00',
    all_day: initial.all_day ?? false,
    location: initial.location ?? '',
    notes: initial.notes ?? '',
    request_id: initial.request_id ?? '',
    platform: initial.platform ?? 'Instagram',
    caption_draft: initial.caption_draft ?? '',
    post_status: initial.post_status ?? 'Draft',
  });
  const [people, setPeople] = useState<string[]>((initial.calendar_assignees ?? []).map((a) => a.user_id));
  const [requests, setRequests] = useState<{ id: string; number: number; title: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const editing = !!initial.id;

  useEffect(() => {
    supabase.from('requests').select('id, number, title').neq('status', 'Posted').order('number', { ascending: false }).limit(100)
      .then(({ data }) => setRequests(data ?? []));
  }, []);

  async function save() {
    setError('');
    if (!f.title.trim()) { setError('Add a title.'); return; }
    const startsAt = new Date(`${f.date}T${f.all_day ? '00:00' : f.start}`);
    const endsAt = f.all_day ? null : new Date(`${f.date}T${f.end}`);
    if (endsAt && endsAt < startsAt) { setError('End time is before the start time.'); return; }
    setBusy(true);
    const row = {
      type: f.type, title: f.title.trim(), starts_at: startsAt.toISOString(), ends_at: endsAt?.toISOString() ?? null,
      all_day: f.all_day, location: f.location || null, notes: f.notes || null, request_id: f.request_id || null,
      platform: f.type === 'Post' ? f.platform : null, caption_draft: f.type === 'Post' ? f.caption_draft || null : null,
      post_status: f.type === 'Post' ? f.post_status : null,
    };
    try {
      let id = initial.id;
      if (editing) {
        const { error } = await supabase.from('calendar_items').update(row).eq('id', id!);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('calendar_items').insert({ ...row, created_by: me!.id }).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      // Sync the people list (each newly added person gets a notification)
      const before = (initial.calendar_assignees ?? []).map((a) => a.user_id);
      const removed = before.filter((u) => !people.includes(u));
      const added = people.filter((u) => !before.includes(u));
      if (removed.length) await supabase.from('calendar_assignees').delete().eq('item_id', id!).in('user_id', removed);
      if (added.length) {
        const { error } = await supabase.from('calendar_assignees').insert(added.map((user_id) => ({ item_id: id!, user_id })));
        if (error) throw error;
      }
      onDone(true);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function remove() {
    if (!confirm(`Delete "${f.title}" from the calendar?`)) return;
    const { error } = await supabase.from('calendar_items').delete().eq('id', initial.id!);
    if (error) setError(error.message); else onDone(true);
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="h-display text-lg">{editing ? 'Edit' : 'New'} calendar item</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select className="input" value={f.type} onChange={set('type')}>{CALENDAR_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        </Field>
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={set('date')} /></Field>
      </div>
      <Field label="Title"><input className="input" maxLength={200} value={f.title} onChange={set('title')} placeholder="e.g. Film Turkey Shootout reel" /></Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5 accent-[#0075E7]" checked={f.all_day} onChange={(e) => setF({ ...f, all_day: e.target.checked })} /> All day
      </label>
      {!f.all_day && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><input className="input" type="time" value={f.start} onChange={set('start')} /></Field>
          <Field label="End"><input className="input" type="time" value={f.end} onChange={set('end')} /></Field>
        </div>
      )}
      <Field label="Location"><input className="input" value={f.location} onChange={set('location')} placeholder="e.g. Court 3" /></Field>
      <Field label="Linked request">
        <select className="input" value={f.request_id} onChange={set('request_id')}>
          <option value="">— none —</option>
          {requests.map((r) => <option key={r.id} value={r.id}>#{r.number} {r.title}</option>)}
        </select>
      </Field>
      {f.type === 'Post' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform">
            <select className="input" value={f.platform} onChange={set('platform')}>
              {['Instagram', 'Facebook', 'Instagram + Facebook', 'TikTok', 'YouTube', 'Other'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Post status">
            <select className="input" value={f.post_status} onChange={set('post_status')}>{POST_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
          <div className="col-span-2">
            <Field label="Caption draft"><textarea className="input min-h-24" value={f.caption_draft} onChange={set('caption_draft')} /></Field>
          </div>
        </div>
      )}
      <Field label="Notes"><textarea className="input min-h-20" value={f.notes} onChange={set('notes')} placeholder="Shot list, what to wear, gear…" /></Field>
      <div>
        <span className="label">People (they'll get notified)</span>
        <MemberPicker selected={people} onChange={setPeople} />
      </div>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <button className="btn btn-primary flex-1" disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add to calendar'}</button>
        <button className="btn btn-ghost" onClick={() => onDone(false)}>Cancel</button>
      </div>
      {editing && <button className="text-sm text-red-600 underline" onClick={remove}>Delete this item</button>}
    </div>
  );
}
