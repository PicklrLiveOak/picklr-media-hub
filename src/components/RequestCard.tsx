import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { PRIORITY_STYLE } from '../lib/constants';
import { fmtDate, isOverdue } from '../lib/format';
import type { MediaRequest } from '../lib/types';
import { Avatar, StatusChip } from './ui';

export default function RequestCard({ r, showStatus = true }: { r: MediaRequest; showStatus?: boolean }) {
  const { person, deptName, pillarColor } = useAuth();
  const overdue = isOverdue(r.needed_by, r.status);
  return (
    <Link to={`/r/${r.number}`} className="card block p-3 hover:border-blue">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-stone-500 font-semibold">
            #{r.number} · {r.type}{(r.department_label || r.department_id) ? ` · ${r.department_label || deptName(r.department_id)}` : ''}
          </div>
          <div className="font-semibold leading-snug">{r.title}</div>
        </div>
        {showStatus && <StatusChip status={r.status} />}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {r.needed_by && (
            <span className={overdue ? 'text-red-600 font-bold' : 'text-stone-600'}>
              Due {fmtDate(r.needed_by)}
            </span>
          )}
          {r.priority !== 'Normal' && <span className={PRIORITY_STYLE[r.priority]}>{r.priority}</span>}
          {r.pillar && <span className="truncate font-semibold" style={{ color: pillarColor(r.pillar) }}>● {r.pillar}</span>}
        </div>
        <div className="flex -space-x-1.5">
          {(r.request_assignees ?? []).map((a) => <Avatar key={a.user_id} person={person(a.user_id)} size={22} />)}
        </div>
      </div>
    </Link>
  );
}
