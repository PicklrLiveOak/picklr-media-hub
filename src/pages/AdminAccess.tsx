// Admin → Access: pick each person's access level, then fine-tune the
// most-used switches. (Every individual permission is on Admin → People.)
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { Avatar, ErrorNote } from '../components/ui';

// What each access level sees by default (keys match role_presets.role)
const LEVEL_HELP: Record<string, string> = {
  admin: 'Everything, plus this Admin page.',
  manager: 'Sees everything: every request, everyone’s calendar, insights. View-only by default.',
  strategy: 'Sees requests in the Strategy stage (plus their own) and their own calendar. Approves to Execution.',
  execution: 'Sees requests in the Execution stage (plus their own) and their own calendar. Schedules shoots.',
  lead: 'Their department’s requests, plus their own calendar.',
  staff: 'Default for everyone else: only the requests, calendar items and progress tied to them.',
};

const COLUMNS: { key: string; label: string; short: string }[] = [
  { key: 'requests.view_all', label: 'Sees every request (off = only the ones relevant to them)', short: 'All requests' },
  { key: 'section.insights', label: 'Can open Insights & analytics', short: 'Insights' },
  { key: 'calendar.view_all', label: "Sees everyone's calendar (off = only their own events)", short: 'All calendar' },
  { key: 'calendar.edit', label: 'Can add & edit calendar items', short: 'Edit calendar' },
  { key: 'team.strategy', label: 'Strategy team — gets new requests, approves to Execution', short: 'Strategy' },
  { key: 'team.execution', label: 'Execution team — gets approved requests, schedules shoots', short: 'Execution' },
  { key: 'section.board', label: 'Can open the Board', short: 'Board' },
  { key: 'section.chat', label: 'Can use Chat', short: 'Chat' },
];

export default function AdminAccess() {
  const { team, me, presets, reload } = useAuth();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const people = team.filter((t) => t.active && !t.is_service_account);

  async function toggle(id: string, key: string, on: boolean) {
    const p = team.find((t) => t.id === id)!;
    setBusy(`${id}:${key}`); setError('');
    const permissions = on ? [...new Set([...p.permissions, key])] : p.permissions.filter((k) => k !== key);
    const { error } = await supabase.from('profiles').update({ permissions }).eq('id', id);
    if (error) setError(error.message);
    await reload();
    setBusy('');
  }

  async function setLevel(id: string, role: string) {
    const preset = presets.find((r) => r.role === role);
    if (!preset) return;
    if (!confirm(`Make them ${preset.label}?\n\nTheir switches reset to the ${preset.label} defaults. You can still fine-tune them after.`)) return;
    setBusy(`${id}:role`); setError('');
    const { error } = await supabase.from('profiles').update({ role, permissions: preset.permissions }).eq('id', id);
    if (error) setError(error.message);
    await reload();
    setBusy('');
  }

  return (
    <div className="space-y-3">
      <details className="card p-3 text-sm">
        <summary className="font-semibold cursor-pointer">What each access level sees</summary>
        <ul className="mt-2 space-y-1 text-stone-700">
          {presets.filter((r) => LEVEL_HELP[r.role]).map((r) => <li key={r.role}><b>{r.label}</b> — {LEVEL_HELP[r.role]}</li>)}
        </ul>
      </details>
      <ul className="text-xs text-stone-600 space-y-0.5">
        {COLUMNS.map((c) => <li key={c.key}><b>{c.short}</b> — {c.label}</li>)}
      </ul>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-left text-stone-500 border-b border-line">
              <th className="p-2 font-semibold sticky left-0 bg-white">Person</th>
              <th className="p-2 font-semibold">Access level</th>
              {COLUMNS.map((c) => <th key={c.key} className="p-2 font-semibold text-center whitespace-nowrap">{c.short}</th>)}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const self = p.id === me?.id;
              const admin = p.role === 'admin';
              return (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="p-2 sticky left-0 bg-white">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar person={p} size={24} /><span className="truncate max-w-[9rem]">{p.full_name}</span>
                    </div>
                  </td>
                  <td className="p-2">
                    <select className="input !py-1 !w-auto text-sm" value={p.role} aria-label={`Access level for ${p.full_name}`}
                      disabled={self || busy === `${p.id}:role`} onChange={(e) => setLevel(p.id, e.target.value)}>
                      {presets.filter((r) => r.role !== 'claude').map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
                    </select>
                  </td>
                  {COLUMNS.map((c) => {
                    const on = admin || p.permissions.includes(c.key);
                    const locked = self || admin;
                    return (
                      <td key={c.key} className="p-2 text-center">
                        <input type="checkbox" className="h-5 w-5 accent-[#0075E7] disabled:opacity-40"
                          checked={on} disabled={locked || busy === `${p.id}:${c.key}`}
                          title={locked ? (admin ? 'Admins always have every permission' : "You can't change your own access") : c.label}
                          onChange={(e) => toggle(p.id, c.key, e.target.checked)} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">Changes save instantly. Changing the level resets that person's switches to its defaults; then tick any extras. Admins always have everything; you can't change your own row.</p>
      <ErrorNote error={error} />
    </div>
  );
}
