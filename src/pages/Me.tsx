// Me: my profile, photo, password, install instructions, sign out.
// Notifications: turn on phone alerts for this device + choose what to get.
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { prepareFile, uploadFile } from '../lib/upload';
import { Avatar, ErrorNote, Field, PageHeader, Toast } from '../components/ui';
import NotifySettings from '../components/NotifySettings';
import { disablePush } from '../lib/push';

export default function Me() {
  const { me, reload, deptName, presets } = useAuth();
  const [f, setF] = useState({ full_name: me!.full_name, phone: me!.phone ?? '', contact_email: me!.contact_email ?? '' });
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const done = (m: string) => { setMsg(m); setError(''); };

  async function saveProfile() {
    const { error } = await supabase.from('profiles').update({
      full_name: f.full_name, phone: f.phone || null, contact_email: f.contact_email || null,
    }).eq('id', me!.id);
    if (error) setError(error.message); else { done('Profile saved.'); reload(); }
  }

  async function changePhoto(file?: File) {
    if (!file) return;
    try {
      const path = await uploadFile(`avatars/${me!.id}`, await prepareFile(file));
      const old = me!.avatar_path;
      await supabase.from('profiles').update({ avatar_path: path }).eq('id', me!.id);
      if (old) await supabase.storage.from('uploads').remove([old]); // don't keep old photos around
      done('Photo updated.'); reload();
    } catch (e) { setError((e as Error).message); }
  }

  async function changePassword() {
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setError(error.message); else { done('Password changed.'); setPw(''); }
  }

  return (
    <div className="max-w-xl space-y-5">
      <PageHeader title="Me" />

      <section className="card p-4 flex items-center gap-4">
        <Avatar person={me!} size={64} />
        <div className="flex-1">
          <div className="font-bold">{me!.full_name}</div>
          <div className="text-sm text-stone-500">@{me!.username} · {presets.find((r) => r.role === me!.role)?.label}</div>
          <div className="text-sm text-stone-500">{deptName(me!.department_id)}</div>
        </div>
        <label className="btn btn-ghost text-sm cursor-pointer">
          Photo
          <input type="file" accept="image/*" className="hidden" onChange={(e) => changePhoto(e.target.files?.[0])} />
        </label>
      </section>

      <NotifySettings />

      <section className="card p-4 space-y-3">
        <h2 className="h-display text-lg">Profile</h2>
        <Field label="Name"><input className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></Field>
        <button className="btn btn-dark" onClick={saveProfile}>Save profile</button>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="h-display text-lg">Change password</h2>
        <input className="input" type="password" placeholder="New password (8+ characters)" autoComplete="new-password"
          value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn btn-dark" disabled={pw.length < 8} onClick={changePassword}>Change password</button>
      </section>

      <section className="card p-4 text-sm space-y-2">
        <h2 className="h-display text-lg">Put it on your phone</h2>
        <p><b>iPhone:</b> open this site in Safari → Share button → <i>Add to Home Screen</i>.</p>
        <p><b>Android:</b> open in Chrome → ⋮ menu → <i>Install app</i> (or <i>Add to Home screen</i>).</p>
      </section>

      <ErrorNote error={error} />
      <Toast msg={msg} onDone={() => setMsg('')} />

      <button className="btn btn-ghost w-full" onClick={async () => { await disablePush().catch(() => {}); await supabase.auth.signOut(); }}>Sign out</button>
    </div>
  );
}
