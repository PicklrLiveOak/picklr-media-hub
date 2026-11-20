// Home: big "new request" button + the status of my requests + what's assigned to me.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useChats } from '../lib/chats';
import { supabase } from '../lib/supabase';
import type { MediaRequest } from '../lib/types';
import RequestCard from '../components/RequestCard';

export default function Home() {
  const { me, can } = useAuth();
  const { chats, totalUnread } = useChats();
  const mentions = chats.filter((c) => c.mentioned).length;
  const [mine, setMine] = useState<MediaRequest[]>([]);
  const [assigned, setAssigned] = useState<MediaRequest[]>([]);

  useEffect(() => {
    if (!me) return;
    supabase.from('requests').select('*, request_assignees(user_id)')
      .or(`requester_id.eq.${me.id},created_by.eq.${me.id}`)
      .order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setMine((data as MediaRequest[]) ?? []));
    supabase.from('requests').select('*, request_assignees!inner(user_id)')
      .eq('request_assignees.user_id', me.id).neq('status', 'Posted')
      .order('needed_by', { ascending: true, nullsFirst: false })
      .then(({ data }) => setAssigned((data as MediaRequest[]) ?? []));
  }, [me]);

  const firstName = me?.full_name.split(' ')[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h-display text-4xl">Hey {firstName}</h1>
        <p className="text-stone-600 text-sm mt-1">What does the media team need to know?</p>
      </div>

      {can('section.requests') && (
        <Link to="/new" className="btn btn-primary w-full text-lg py-4">＋ New media request</Link>
      )}

      {totalUnread > 0 && (
        <Link to="/chat" className="card flex items-center justify-between p-3 border-blue">
          <span className="font-semibold">💬 {totalUnread} unread message{totalUnread === 1 ? '' : 's'}</span>
          {mentions > 0 && <span className="text-xs font-bold text-white bg-red-600 rounded-full px-2 py-0.5">@ {mentions} mention{mentions === 1 ? '' : 's'}</span>}
        </Link>
      )}

      {assigned.length > 0 && (
        <section>
          <h2 className="h-display text-xl mb-2">Assigned to me</h2>
          <div className="space-y-2">{assigned.map((r) => <RequestCard key={r.id} r={r} />)}</div>
        </section>
      )}

      <section>
        <h2 className="h-display text-xl mb-2">My requests</h2>
        {mine.length === 0
          ? <p className="text-sm text-stone-500">You haven't requested anything yet.</p>
          : <div className="space-y-2">{mine.map((r) => <RequestCard key={r.id} r={r} />)}</div>}
      </section>
    </div>
  );
}
