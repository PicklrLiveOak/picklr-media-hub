// The short request form staff fill out on their phones.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { REQUEST_TYPES } from '../lib/constants';
import { ACCEPT, prepareFile, uploadFile } from '../lib/upload';
import type { DriveLink } from '../lib/types';
import { ErrorNote, Field, PageHeader } from '../components/ui';
import LinksEditor, { cleanLinks } from '../components/LinksEditor';

export default function NewRequest() {
  const { me, team, departments, can } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({
    title: '', requester_id: me!.id, department_id: me!.department_id ?? '', type: 'Graphic',
    event_name: '', event_date: '', needed_by: '', details: '',
  });
  const [links, setLinks] = useState<DriveLink[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setBusy('Saving…');
    try {
      const { data: req, error } = await supabase.from('requests').insert({
        title: f.title.trim(),
        requester_id: f.requester_id,
        department_id: f.department_id || null,
        type: f.type,
        event_name: f.event_name || null,
        event_date: f.event_date || null,
        needed_by: f.needed_by || null,
        details: f.details || null,
        drive_links: cleanLinks(links),
      }).select('id, number').single();
      if (error) throw error;

      for (const [i, raw] of files.entries()) {
        setBusy(`Uploading ${i + 1} of ${files.length}…`);
        const file = await prepareFile(raw);
        const path = await uploadFile(`requests/${req.id}`, file);
        const { error: fe } = await supabase.from('request_files').insert({
          request_id: req.id, storage_path: path, file_name: file.name, mime: file.type, size_bytes: file.size,
        });
        if (fe) throw fe;
      }
      nav(`/r/${req.number}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy('');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <PageHeader title="New request" />

      <Field label="What do you need? *">
        <input className="input" required maxLength={200} placeholder="e.g. Reel for Friday Night Mixer"
          value={f.title} onChange={set('title')} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Type *">
          <select className="input" value={f.type} onChange={set('type')}>
            {REQUEST_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select className="input" value={f.department_id} onChange={set('department_id')}>
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>

      {/* Media team can file a request on someone else's behalf */}
      {can('requests.manage') && (
        <Field label="Requested by">
          <select className="input" value={f.requester_id} onChange={set('requester_id')}>
            {team.filter((t) => t.active && !t.is_service_account).map((t) => (
              <option key={t.id} value={t.id}>{t.full_name}</option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Event or program name">
        <input className="input" placeholder="e.g. Thanksgiving Turkey Shootout" value={f.event_name} onChange={set('event_name')} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Event date"><input className="input" type="date" value={f.event_date} onChange={set('event_date')} /></Field>
        <Field label="Needed by"><input className="input" type="date" value={f.needed_by} onChange={set('needed_by')} /></Field>
      </div>

      <Field label="Details">
        <textarea className="input min-h-32" placeholder="Who, what, key info, links to registration, must-have shots…"
          value={f.details} onChange={set('details')} />
      </Field>

      <div>
        <span className="label">Images or PDFs (max 10 MB each)</span>
        <input type="file" accept={ACCEPT} multiple className="block text-sm"
          onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
        {files.length > 0 && (
          <ul className="mt-2 text-sm space-y-1">
            {files.map((file, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">{file.name}</span>
                <button type="button" className="text-red-600" onClick={() => setFiles(files.filter((_, j) => j !== i))}>remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <span className="label">Video or big files → Google Drive links</span>
        <LinksEditor links={links} onChange={setLinks} />
      </div>

      <ErrorNote error={error} />
      <button className="btn btn-primary w-full py-4 text-lg" disabled={!!busy}>{busy || 'Submit request'}</button>
    </form>
  );
}
