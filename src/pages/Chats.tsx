// Chat list: DMs, group chats and request threads I'm in, with unread badges.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useChats } from '../lib/chats';
import { supabase } from '../lib/supabase';
import { fmtDateTime } from '../lib/format';
import type { ChatRow } from '../lib/types';
import MemberPicker from '../components/MemberPicker';
import { Avatar, ErrorNote, Field, PageHeader } from '../components/ui';

export default function Chats() {
  const { can } = useAuth();
  const { chats } = useChats();
  const [mode, setMode] = useState<'' | 'dm' | 'group'>('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'requests'>('all');

  const shown = chats.filter((c) =>
    filter === 'unread' ? c.unread > 0 : filter === 'requests' ? c.kind === 'request' : true);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Chat" right={
        <div className="flex gap-2">
          <button className="btn btn-ghost text-sm" onClick={() => setMode(mode === 'dm' ? '' : 'dm')}>＋ Message</button>
          {can('chat.create_groups') && (
            <button className="btn btn-primary text-sm" onClick={() => setMode(mode === 'group' ? '' : 'group')}>＋ Group</button>
          )}
        </div>
      } />

      {mode === 'dm' && <NewDM onClose={() => setMode('')} />}
      {mode === 'group' && <NewGroup onClose={() => setMode('')} />}

      <div className="flex gap-2 mb-3 text-sm font-semibold">
        {(['all', 'unread', 'requests'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 capitalize ${filter === f ? 'bg-ink text-cream' : 'bg-white border border-line'}`}>{f}</button>
        ))}
      </div>

      {shown.length === 0 && <p className="text-sm text-stone-500">Nothing here yet.</p>}
      <ul className="space-y-2">
        {shown.map((c) => <ChatListItem key={c.id} c={c} />)}
      </ul>
    </div>
  );
}

export function chatTitle(c: ChatRow, name: (id: string | null) => string) {
  if (c.kind === 'group') return c.name ?? 'Group';
  if (c.kind === 'request') return `#${c.request_number} ${c.request_title ?? ''}`;
  return name(c.other_user);
}

function ChatListItem({ c }: { c: ChatRow }) {
  const { person } = useAuth();
  const other = person(c.other_user);
  const title = chatTitle(c, (id) => person(id)?.full_name ?? 'Direct message');
  const last = c.last_body ? `${person(c.last_author)?.full_name.split(' ')[0] ?? ''}: ${c.last_body}` : 'No messages yet';
  return (
    <li>
      <Link to={`/chat/${c.id}`} className="card flex items-center gap-3 p-3 hover:border-blue">
        {c.kind === 'dm' ? <Avatar person={other} size={40} /> : (
          <span className={`grid place-items-center h-10 w-10 rounded-full shrink-0 text-lg ${c.kind === 'group' ? 'bg-blue text-white' : 'bg-cream border border-line'}`}>
            {c.kind === 'group' ? '#' : '📝'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate ${c.unread ? 'font-bold' : 'font-semibold'}`}>{title}</span>
            <span className="text-[11px] text-stone-500 shrink-0">{fmtDateTime(c.last_message_at)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-sm truncate ${c.unread ? 'text-ink' : 'text-stone-500'}`}>{last}</span>
            {c.unread > 0 && (
              <span className={`shrink-0 rounded-full text-white text-[11px] font-bold px-2 py-0.5 ${c.mentioned ? 'bg-red-600' : 'bg-blue'}`}>
                {c.mentioned ? '@ ' : ''}{c.unread}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function NewDM({ onClose }: { onClose: () => void }) {
  const { team, me } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const people = team.filter((t) => t.active && t.id !== me?.id &&
    `${t.full_name} ${t.username}`.toLowerCase().includes(q.toLowerCase()));

  async function open(id: string) {
    const { data, error } = await supabase.rpc('start_dm', { other: id });
    if (error) setError(error.message); else { onClose(); nav(`/chat/${data}`); }
  }
  return (
    <div className="card p-3 mb-4 space-y-2">
      <input className="input" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="divide-y divide-line max-h-72 overflow-y-auto">
        {people.map((p) => (
          <li key={p.id}>
            <button className="w-full flex items-center gap-3 py-2 text-left" onClick={() => open(p.id)}>
              <Avatar person={p} size={32} /> <span className="font-semibold">{p.full_name}</span>
              <span className="text-sm text-stone-500">@{p.username}</span>
            </button>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </div>
  );
}

export function NewGroup({ onClose }: { onClose: (id?: string) => void }) {
  const nav = useNavigate();
  const { reload } = useChats();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState('');
  async function create() {
    const { data, error } = await supabase.rpc('create_group', { p_name: name, p_members: members });
    if (error) { setError(error.message); return; }
    await reload();
    onClose(data as string);
    nav(`/chat/${data}`);
  }
  return (
    <div className="card p-3 mb-4 space-y-3">
      <Field label="Group name"><input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Turkey Shootout crew" /></Field>
      <MemberPicker selected={members} onChange={setMembers} />
      <ErrorNote error={error} />
      <button className="btn btn-primary w-full" disabled={!name.trim()} onClick={create}>Create group ({members.length} people + you)</button>
    </div>
  );
}
