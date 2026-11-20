// Team (admin only): add people, set role/department, flip individual permission
// toggles, reset passwords, deactivate accounts.
import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { PERMISSIONS } from '../lib/constants';
import type { Profile } from '../lib/types';
import { Avatar, ErrorNote, Field, PageHeader, Toast, Toggle } from '../components/ui';

// Calls the admin-users Edge Function (holds the service key server-side).
async function adminCall(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // The function returns { error: "..." } with a 4xx status
    const msg = await error.context?.json?.().then((j: { error?: string }) => j.error).catch(() => null);
    throw new Error(msg || error.message);
  }
  return data;
}

export default function Team() {
  const { team, presets, departments, deptName, reload } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-stone-600">Tap a person to change their role, department or permissions.</p>
        <button className="btn btn-primary text-sm shrink-0" onClick={() => setAdding(!adding)}>{adding ? 'Close' : '＋ Add person'}</button>
      </div>

      {adding && <AddPerson onDone={() => { setAdding(false); reload(); }} />}

      <div className="space-y-2">
        {team.map((p) => (
          <div key={p.id} className={`card ${p.active ? '' : 'opacity-60'}`}>
            <button className="w-full flex items-center gap-3 p-3 text-left" onClick={() => setOpen(open === p.id ? null : p.id)}>
              <Avatar person={p} size={36} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{p.full_name} {!p.active && <span className="text-xs text-red-600">(deactivated)</span>}</div>
                <div className="text-xs text-stone-500 truncate">
                  @{p.username} · {presets.find((r) => r.role === p.role)?.label}{p.department_id ? ` · ${deptName(p.department_id)}` : ''}
                </div>
              </div>
              <span className="text-stone-400">{open === p.id ? '▴' : '▾'}</span>
            </button>
            {open === p.id && <EditPerson p={p} departments={departments} onSaved={reload} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddPerson({ onDone }: { onDone: () => void }) {
  const { presets, departments } = useAuth();
  const [f, setF] = useState({ full_name: '', username: '', password: '', role: 'staff', department_id: '', phone: '', contact_email: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await adminCall({ action: 'create', ...f, department_id: f.department_id ? Number(f.department_id) : null });
      alert(`Account created.\n\nUsername: ${f.username.toLowerCase()}\nPassword: the one you typed\n\nShare it with them privately — they can change it on their Me page.`);
      onDone();
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card p-4 mb-4 space-y-3">
      <h2 className="h-display text-lg">New account</h2>
      <Field label="Full name *"><input className="input" required value={f.full_name} onChange={set('full_name')} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Username *">
          <input className="input" required pattern="[a-zA-Z0-9._\-]{2,32}" autoCapitalize="none" placeholder="e.g. michaela"
            value={f.username} onChange={set('username')} />
        </Field>
        <Field label="Temporary password *">
          <input className="input" required minLength={8} value={f.password} onChange={set('password')} />
        </Field>
        <Field label="Role (sets default permissions)">
          <select className="input" value={f.role} onChange={set('role')}>
            {presets.filter((r) => r.role !== 'admin').map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select className="input" value={f.department_id} onChange={set('department_id')}>
            <option value="">—</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Phone"><input className="input" type="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Contact email"><input className="input" type="email" value={f.contact_email} onChange={set('contact_email')} /></Field>
      </div>
      <ErrorNote error={error} />
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
    </form>
  );
}

function EditPerson({ p, departments, onSaved }: { p: Profile; departments: { id: number; name: string }[]; onSaved: () => Promise<void> }) {
  const { me, presets } = useAuth();
  const [d, setD] = useState(p);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const isSelf = me?.id === p.id;
  const dirty = JSON.stringify(d) !== JSON.stringify(p);

  function pickRole(role: string) {
    const preset = presets.find((r) => r.role === role);
    const reset = confirm(`Switch to ${preset?.label}?\n\nOK = also reset their toggles to that role's defaults.\nCancel = keep their current toggles.`);
    setD({ ...d, role, permissions: reset && preset ? preset.permissions : d.permissions });
  }

  function togglePerm(key: string, on: boolean) {
    setD({ ...d, permissions: on ? [...new Set([...d.permissions, key])] : d.permissions.filter((k) => k !== key) });
  }

  async function save() {
    setError(''); setMsg('');
    const { error } = await supabase.from('profiles').update({
      full_name: d.full_name, role: d.role, department_id: d.department_id, phone: d.phone,
      contact_email: d.contact_email, permissions: d.permissions,
    }).eq('id', p.id);
    if (error) setError(error.message); else { setMsg('Saved.'); await onSaved(); }
  }

  async function run(body: Record<string, unknown>, ok: string) {
    setError(''); setMsg('');
    try { await adminCall(body); setMsg(ok); await onSaved(); } catch (e) { setError((e as Error).message); }
  }

  const groups = [...new Set(PERMISSIONS.map((x) => x.group))];

  return (
    <div className="border-t border-line p-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Full name"><input className="input" value={d.full_name} onChange={(e) => setD({ ...d, full_name: e.target.value })} /></Field>
        <Field label="Role">
          <select className="input" value={d.role} disabled={isSelf || p.is_service_account} onChange={(e) => pickRole(e.target.value)}>
            {presets.filter((r) => (p.is_service_account ? r.role === 'claude' : r.role !== 'claude')).map((r) =>
              <option key={r.role} value={r.role}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select className="input" value={d.department_id ?? ''} disabled={isSelf}
            onChange={(e) => setD({ ...d, department_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Phone"><input className="input" value={d.phone ?? ''} onChange={(e) => setD({ ...d, phone: e.target.value || null })} /></Field>
      </div>

      <div>
        <h3 className="font-bold text-sm mb-1">Permissions</h3>
        {isSelf && <p className="text-xs text-stone-500">You can't change your own access (prevents locking yourself out).</p>}
        {d.role === 'admin' && !isSelf && <p className="text-xs text-stone-500">Admins have every permission.</p>}
        {groups.map((g) => (
          <div key={g} className="mt-2">
            <div className="text-xs uppercase tracking-wide text-stone-500 font-semibold">{g}</div>
            <div className="divide-y divide-line">
              {PERMISSIONS.filter((x) => x.group === g).map((x) => {
                const locked = isSelf || d.role === 'admin' || (p.is_service_account && x.key === 'team.manage');
                return (
                  <Toggle key={x.key} label={x.label} disabled={locked}
                    checked={d.role === 'admin' || d.permissions.includes(x.key)}
                    onChange={(on) => togglePerm(x.key, on)} />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {dirty && <button className="btn btn-primary w-full" onClick={save}>Save changes</button>}

      {!isSelf && (
        <div className="space-y-3 border-t border-line pt-3">
          <div className="flex gap-2">
            <input className="input" placeholder="New password (8+ characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <button className="btn btn-ghost shrink-0" disabled={newPassword.length < 8}
              onClick={() => run({ action: 'reset_password', user_id: p.id, password: newPassword }, 'Password reset.').then(() => setNewPassword(''))}>
              Reset
            </button>
          </div>
          <button className={`btn w-full ${p.active ? 'btn-ghost text-red-600' : 'btn-dark'}`}
            onClick={() => run({ action: 'set_active', user_id: p.id, active: !p.active }, p.active ? 'Deactivated.' : 'Reactivated.')}>
            {p.active ? 'Deactivate account' : 'Reactivate account'}
          </button>
        </div>
      )}
      <ErrorNote error={error} />
      <Toast msg={msg} onDone={() => setMsg('')} />
    </div>
  );
}
