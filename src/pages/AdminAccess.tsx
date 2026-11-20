// Admin → Access: one grid to flip the most-used switches for everyone at once.
// (Every individual permission is still on Admin → People.)
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { Avatar, ErrorNote } from '../components/ui';

const COLUMNS: { key: string; label: string; short: string }[] = [
  { key: 'section.insights', label: 'Can open Insights & analytics', short: 'Insights' },
  { key: 'calendar.view_all', label: "Sees everyone's calendar (off = only their own events)", short: 'All calendar' },
  { key: 'calendar.edit', label: 'Can add & edit calendar items', short: 'Edit calendar' },
  { key: 'team.strategy', label: 'Strategy team — gets new requests, approves to Execution', short: 'Strategy' },
  { key: 'team.execution', label: 'Execution team — gets approved requests, schedules shoots', short: 'Execution' },
  { key: 'section.board', label: 'Can open the Board', short: 'Board' },
  { key: 'section.chat', label: 'Can use Chat', short: 'Chat' },
];

export default function AdminAccess() {
  const { team, me, reload } = useAuth();
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

  return (
    <div className="space-y-3">
      <ul className="text-xs text-stone-600 space-y-0.5">
        {COLUMNS.map((c) => <li key={c.key}><b>{c.short}</b> — {c.label}</li>)}
      </ul>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-stone-500 border-b border-line">
              <th className="p-2 font-semibold sticky left-0 bg-white">Person</th>
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
      <p className="text-xs text-stone-500">Changes save instantly. Admins always have everything; you can't change your own row.</p>
      <ErrorNote error={error} />
    </div>
  );
}
