// Edits a list of {label, url} links (Google Drive etc.).
import type { DriveLink } from '../lib/types';

export default function LinksEditor({ links, onChange, disabled }: {
  links: DriveLink[]; onChange: (l: DriveLink[]) => void; disabled?: boolean;
}) {
  const set = (i: number, patch: Partial<DriveLink>) =>
    onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {links.map((l, i) => (
        // Link on top, its label underneath — roomy enough to paste into on a phone.
        <div key={i} className="flex gap-2 items-start">
          <div className="flex-1 min-w-0 space-y-1.5">
            <input className="input" placeholder="Paste Drive link (https://…)" type="url" inputMode="url" value={l.url}
              disabled={disabled} onChange={(e) => set(i, { url: e.target.value })} />
            <input className="input" placeholder="Label, e.g. Raw footage" value={l.label} disabled={disabled}
              onChange={(e) => set(i, { label: e.target.value })} />
          </div>
          {!disabled && (
            <button type="button" className="btn btn-ghost px-3 shrink-0" aria-label="Remove link"
              onClick={() => onChange(links.filter((_, j) => j !== i))}>✕</button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" className="btn btn-ghost text-sm" onClick={() => onChange([...links, { label: '', url: '' }])}>
          ＋ Add Drive link
        </button>
      )}
    </div>
  );
}

// Drop empty rows before saving
export const cleanLinks = (links: DriveLink[]) =>
  links.filter((l) => l.url.trim()).map((l) => ({ label: l.label.trim() || 'Link', url: l.url.trim() }));
