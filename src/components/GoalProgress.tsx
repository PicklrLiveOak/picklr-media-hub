// Posting goals vs what was actually posted (goals are set in Admin → Setup).
// Used by the Insights page and the printable report.
import { Link } from 'react-router-dom';
import type { GoalTable } from '../lib/insights';
import { useAuth } from '../lib/auth';

const PLATFORM: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', all: 'IG + FB' };

export default function GoalProgress({ tables, print = false }: { tables: GoalTable[]; print?: boolean }) {
  const { me } = useAuth();
  if (tables.length === 0) {
    return (
      <p className="text-sm text-stone-500">
        No posting goals set.{me?.role === 'admin' && !print && <> Add some in <Link to="/admin?tab=setup" className="text-blue underline">Admin → Setup</Link>.</>}
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {tables.map((t) => {
        const current = t.rows.find((r) => r.current);
        return (
          <div key={t.period} className="space-y-3">
            {/* This week / this month at a glance */}
            {current && !print && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {t.goals.map((g) => {
                  const n = current.counts[g.id] ?? 0;
                  const pct = Math.min(100, Math.round((n / g.target) * 100));
                  return (
                    <div key={g.id} className="rounded-lg border border-line p-2.5 min-w-0">
                      <div className="text-xs text-stone-500 truncate">{g.name} · this {t.period}</div>
                      <div className="font-bold text-lg leading-tight">{n}<span className="text-stone-400 text-sm font-semibold">/{g.target}</span></div>
                      <div className="h-1.5 rounded-full bg-stone-200 mt-1 overflow-hidden" role="progressbar"
                        aria-valuenow={n} aria-valuemax={g.target} aria-label={`${g.name} progress`}>
                        <div className={`h-full rounded-full ${n >= g.target ? 'bg-emerald-600' : 'bg-blue'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th className="py-1 font-semibold pr-2">{t.period === 'week' ? 'Week of' : 'Month'}</th>
                    {t.goals.map((g) => (
                      <th key={g.id} className="font-semibold text-right px-1 whitespace-nowrap" title={`${PLATFORM[g.platform]}`}>{g.name}</th>
                    ))}
                    <th className="text-right pl-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((r) => (
                    <tr key={r.key} className="border-t border-line">
                      <td className="py-1.5 pr-2 whitespace-nowrap">{r.label}{r.current ? ' (so far)' : ''}</td>
                      {t.goals.map((g) => {
                        const n = r.counts[g.id] ?? 0;
                        return <td key={g.id} className={`text-right px-1 ${n >= g.target ? '' : r.current ? 'text-stone-500' : 'text-red-600'}`}>{n}/{g.target}</td>;
                      })}
                      <td className="text-right pl-1 whitespace-nowrap">{r.met ? (print ? 'Met' : '✅ Met') : r.current ? (print ? 'In progress' : '⏳') : (print ? 'Short' : '⚠️ Short')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-stone-500">
              {t.goals.map((g) => `${g.name}: ${g.target}/${t.period} on ${PLATFORM[g.platform]}`).join(' · ')}
            </p>
          </div>
        );
      })}
    </div>
  );
}
