// Small shared UI pieces.
import { useEffect, useState, type ReactNode } from 'react';
import { STATUS_STYLE } from '../lib/constants';
import { initials } from '../lib/format';
import { signedUrl } from '../lib/upload';
import type { Profile } from '../lib/types';

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATUS_STYLE[status] ?? ''}`}>
      {status}
    </span>
  );
}

export function Avatar({ person, size = 28 }: { person?: Profile; size?: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (person?.avatar_path) signedUrl(person.avatar_path).then(setUrl);
    else setUrl('');
  }, [person?.avatar_path]);
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (url) return <img src={url} alt={person?.full_name} style={style} className="rounded-full object-cover shrink-0" />;
  return (
    <span style={style} title={person?.full_name}
      className="rounded-full bg-ink text-cream grid place-items-center font-bold shrink-0">
      {person ? initials(person.full_name) : '?'}
    </span>
  );
}

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <h1 className="h-display text-3xl">{title}</h1>
      {right}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function ErrorNote({ error }: { error: string }) {
  if (!error) return null;
  return <p className="rounded-lg bg-red-50 text-red-700 text-sm p-3">{error}</p>;
}

/** Short success message pinned just above the phone tab bar so it's always visible. Fades after 3s. */
export function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  if (!msg) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-above-tabbar z-30 flex justify-center px-4 pointer-events-none">
      <p className="rounded-full bg-ink text-cream text-sm font-semibold px-4 py-2 shadow-lg">✓ {msg}</p>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 py-2 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-sm">{label}</span>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-blue' : 'bg-stone-300'}`}>
        <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}
