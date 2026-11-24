// Notification settings: turning phone notifications on for THIS device
// (Me page only), and choosing which kinds to get (Me page, or the admin
// editing someone on Admin → People).
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { NOTIFY_OPTIONS, disablePush, enablePush, pushState, sendTestPush, type PushState } from '../lib/push';
import type { Profile } from '../lib/types';
import { ErrorNote, Toggle } from './ui';

/** Which kinds of notifications this person gets. Saves right away. */
export function NotifyPrefs({ person, onSaved }: { person: Profile; onSaved: () => Promise<void> }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(person.notify_prefs ?? {});
  const [error, setError] = useState('');
  useEffect(() => setPrefs(person.notify_prefs ?? {}), [person.notify_prefs]);

  const has = (perm?: string) => !perm || person.role === 'admin' || person.permissions.includes(perm);
  async function set(key: string, on: boolean) {
    const next = { ...prefs, [key]: on };
    setPrefs(next); setError('');
    const { error } = await supabase.from('profiles').update({ notify_prefs: next }).eq('id', person.id);
    if (error) { setError(error.message); setPrefs(prefs); } else await onSaved();
  }
  return (
    <div>
      <div className="divide-y divide-line">
        {NOTIFY_OPTIONS.filter((o) => has(o.perm)).map((o) => (
          <Toggle key={o.key} label={o.label} checked={prefs[o.key] !== false} onChange={(on) => set(o.key, on)} />
        ))}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

/** The "Turn on notifications" card for the Me page. */
export default function NotifySettings() {
  const { me, reload } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { pushState().then(setState); }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(''); setMsg('');
    try { await fn(); setMsg(ok); } catch (e) { setError((e as Error).message); }
    setState(await pushState());
    setBusy(false);
  }

  return (
    <section className="card p-4 space-y-3">
      <h2 className="h-display text-lg">Notifications</h2>

      {state === 'needs-install' && (
        <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-sm space-y-1">
          <p className="font-semibold">On iPhone, add Media Hub to your Home Screen first.</p>
          <p>In Safari tap the Share button → <i>Add to Home Screen</i>, then open Media Hub from that new icon and come back here.</p>
        </div>
      )}
      {state === 'unsupported' && <p className="text-sm text-stone-600">This browser can't get notifications. Try Chrome or Safari, or the Home Screen app.</p>}
      {state === 'blocked' && (
        <p className="text-sm text-stone-600">Notifications are blocked for Media Hub. Turn them on in your phone's <b>Settings → Notifications → Media Hub</b> (or the browser's site settings), then reopen the app.</p>
      )}
      {state === 'off' && (
        <>
          <p className="text-sm text-stone-600">Get an alert on this device for chat messages, new requests, approvals and shoots, even when the app is closed.</p>
          <button className="btn btn-primary w-full" disabled={busy} onClick={() => run(enablePush, 'Notifications are on for this device.')}>
            🔔 Turn on notifications
          </button>
        </>
      )}
      {state === 'on' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-emerald-700 flex-1">✓ On for this device</span>
          <button className="btn btn-ghost text-sm" disabled={busy}
            onClick={() => run(async () => { const n = await sendTestPush(); if (!n) throw new Error('No device received it. Try turning notifications off and on again.'); }, 'Test sent. It should pop up in a few seconds.')}>
            Send a test
          </button>
          <button className="btn btn-ghost text-sm" disabled={busy} onClick={() => run(disablePush, 'Notifications are off for this device.')}>Turn off</button>
        </div>
      )}
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      <ErrorNote error={error} />

      <div className="border-t border-line pt-2">
        <h3 className="font-bold text-sm">What to notify me about</h3>
        <p className="text-xs text-stone-500">Applies to every device you've turned on. The 🔔 bell in the app always shows everything.</p>
        {me && <NotifyPrefs person={me} onSaved={reload} />}
      </div>
    </section>
  );
}
