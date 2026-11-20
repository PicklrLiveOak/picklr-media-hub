// All my notifications. Tapping one opens it and marks it read.
import { useNavigate } from 'react-router-dom';
import { NOTICE_ICON, useNotifications } from '../lib/notifications';
import { fmtDateTime } from '../lib/format';
import type { Notice } from '../lib/types';
import { PageHeader } from '../components/ui';

export default function Notifications() {
  const { notices, unread, markRead } = useNotifications();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Notifications" right={unread > 0 && <button className="btn btn-ghost text-sm" onClick={() => markRead()}>Mark all read</button>} />
      {notices.length === 0 && <p className="text-sm text-stone-500">Nothing yet. New requests, approvals, schedules and @mentions show up here.</p>}
      <ul className="space-y-2">{notices.map((n) => <NoticeRow key={n.id} n={n} />)}</ul>
    </div>
  );
}

export function NoticeRow({ n }: { n: Notice }) {
  const nav = useNavigate();
  const { markRead } = useNotifications();
  return (
    <li>
      <button onClick={() => { markRead([n.id]); if (n.link) nav(n.link); }}
        className={`card w-full flex items-start gap-3 p-3 text-left hover:border-blue ${n.read_at ? 'opacity-70' : 'border-blue'}`}>
        <span className="text-xl leading-none mt-0.5">{NOTICE_ICON[n.kind] ?? '🔔'}</span>
        <span className="min-w-0 flex-1">
          <span className={`block ${n.read_at ? 'font-semibold' : 'font-bold'}`}>{n.title}</span>
          {n.body && <span className="block text-sm text-stone-600 truncate">{n.body}</span>}
          <span className="block text-[11px] text-stone-500">{fmtDateTime(n.created_at)}</span>
        </span>
        {!n.read_at && <span className="h-2.5 w-2.5 rounded-full bg-blue mt-2 shrink-0" />}
      </button>
    </li>
  );
}
