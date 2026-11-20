// Home: what needs me right now — notifications, my team's queue, this week's
// calendar, the General chat, and my requests.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useChats } from '../lib/chats';
import { useNotifications } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { addDays, timeLabel, useCalendar } from '../lib/calendar';
import { CALENDAR_STYLE } from '../lib/constants';
import type { MediaRequest } from '../lib/types';
import RequestCard from '../components/RequestCard';
import ChatThread from '../components/ChatThread';
import { NoticeRow } from './Notifications';

export default function Home() {
  const { me, can } = useAuth();
  const { chats, totalUnread } = useChats();
  const { notices } = useNotifications();
  const [mine, setMine] = useState<MediaRequest[]>([]);
  const [assigned, setAssigned] = useState<MediaRequest[]>([]);
  const [strategyQueue, setStrategyQueue] = useState<MediaRequest[]>([]);
  const [execQueue, setExecQueue] = useState<MediaRequest[]>([]);
  const isStrategy = can('team.strategy');
  const isExecution = can('team.execution');

  useEffect(() => {
    if (!me) return;
    const sel = '*, request_assignees(user_id)';
    supabase.from('requests').select(sel).or(`requester_id.eq.${me.id},created_by.eq.${me.id}`)
      .neq('status', 'Posted').order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setMine((data as MediaRequest[]) ?? []));
    supabase.from('requests').select('*, request_assignees!inner(user_id)').eq('request_assignees.user_id', me.id)
      .neq('status', 'Posted').order('needed_by', { ascending: true, nullsFirst: false }).limit(10)
      .then(({ data }) => setAssigned((data as MediaRequest[]) ?? []));
    if (isStrategy) supabase.from('requests').select(sel).in('status', ['New', 'In Strategy'])
      .order('created_at').then(({ data }) => setStrategyQueue((data as MediaRequest[]) ?? []));
    if (isExecution) supabase.from('requests').select(sel).in('status', ['Ready for Execution', 'In Production'])
      .order('needed_by', { ascending: true, nullsFirst: false }).then(({ data }) => setExecQueue((data as MediaRequest[]) ?? []));
  }, [me?.id, isStrategy, isExecution]);

  const unreadNotices = notices.filter((n) => !n.read_at).slice(0, 4);
  const general = chats.find((c) => c.is_default);
  const firstName = me?.full_name.split(' ')[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h-display text-4xl">Hey {firstName}</h1>
        <p className="text-stone-600 text-sm mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {can('section.requests') && (
        <Link to="/new" className="btn btn-primary w-full text-lg py-4">＋ New media request</Link>
      )}

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* Left column */}
        <div className="space-y-5 min-w-0">
          {unreadNotices.length > 0 && (
            <section>
              <SectionTitle title="For you" to="/notifications" link="All notifications" />
              <ul className="space-y-2">{unreadNotices.map((n) => <NoticeRow key={n.id} n={n} />)}</ul>
            </section>
          )}

          {isStrategy && (
            <Queue title="Strategy queue" hint="New requests waiting on a brief/script and approval" items={strategyQueue} />
          )}
          {isExecution && (
            <Queue title="Ready to produce" hint="Approved by Strategy — schedule the shoot" items={execQueue} />
          )}

          {can('section.calendar') && <ThisWeek />}

          {assigned.length > 0 && (
            <section>
              <SectionTitle title="Assigned to me" />
              <div className="space-y-2">{assigned.map((r) => <RequestCard key={r.id} r={r} />)}</div>
            </section>
          )}

          <section>
            <SectionTitle title="My open requests" />
            {mine.length === 0
              ? <p className="text-sm text-stone-500">Nothing open. Tap “New media request” when you need something.</p>
              : <div className="space-y-2">{mine.map((r) => <RequestCard key={r.id} r={r} />)}</div>}
          </section>
        </div>

        {/* Right column: chat */}
        {can('section.chat') && (
          <div className="space-y-5 min-w-0">
            {general && (
              <section className="card p-4">
                <SectionTitle title="📌 General chat" to={`/chat/${general.id}`} link="Open" />
                <ChatThread chatId={general.id} compact />
              </section>
            )}
            {totalUnread > 0 && (
              <Link to="/chat" className="card flex items-center justify-between p-3 border-blue">
                <span className="font-semibold">💬 {totalUnread} unread message{totalUnread === 1 ? '' : 's'} in your chats</span>
                <span className="text-blue text-sm">Open →</span>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title, to, link }: { title: string; to?: string; link?: string }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h2 className="h-display text-xl">{title}</h2>
      {to && <Link to={to} className="text-sm text-blue underline">{link}</Link>}
    </div>
  );
}

function Queue({ title, hint, items }: { title: string; hint: string; items: MediaRequest[] }) {
  return (
    <section>
      <SectionTitle title={`${title} (${items.length})`} to="/board" link="Board" />
      <p className="text-xs text-stone-500 -mt-1 mb-2">{hint}</p>
      {items.length === 0
        ? <p className="text-sm text-stone-500">All clear ✨</p>
        : <div className="space-y-2">{items.slice(0, 5).map((r) => <RequestCard key={r.id} r={r} />)}</div>}
      {items.length > 5 && <Link to="/board" className="text-sm text-blue underline mt-1 inline-block">+{items.length - 5} more on the board</Link>}
    </section>
  );
}

function ThisWeek() {
  const [today] = useState(() => new Date(new Date().setHours(0, 0, 0, 0)));
  const { events } = useCalendar(today, addDays(today, 6));
  const upcoming = events.filter((e) => e.kind !== 'Submitted').slice(0, 8);
  return (
    <section>
      <SectionTitle title="Next 7 days" to="/calendar" link="Calendar" />
      {upcoming.length === 0 ? <p className="text-sm text-stone-500">Nothing on your calendar this week.</p> : (
        <ul className="card divide-y divide-line">
          {upcoming.map((e) => (
            <li key={e.key}>
              <Link to={e.link ?? `/calendar?date=${e.day}`} className="flex items-center gap-2 p-2.5">
                <span className="w-12 shrink-0 text-center">
                  <span className="block text-[10px] uppercase font-bold text-stone-500">{e.start.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <span className="block text-lg font-bold leading-none">{e.start.getDate()}</span>
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${CALENDAR_STYLE[e.type] ?? ''}`}>{e.type}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{e.title}</span>
                  <span className="block text-[11px] text-stone-500">{timeLabel(e)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
