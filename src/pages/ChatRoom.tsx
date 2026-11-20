// One conversation. Group managers can rename it and change members here.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useChats } from '../lib/chats';
import { supabase } from '../lib/supabase';
import ChatThread from '../components/ChatThread';
import MemberPicker from '../components/MemberPicker';
import { Avatar, ErrorNote } from '../components/ui';

type ChatInfo = { id: string; kind: string; name: string | null; request_id: string | null; created_by: string | null; is_default: boolean };

export default function ChatRoom() {
  const { id } = useParams();
  const { me, person, can } = useAuth();
  const { reload } = useChats();
  const nav = useNavigate();
  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [req, setReq] = useState<{ number: number; title: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [missing, setMissing] = useState(false);

  async function load() {
    const { data } = await supabase.from('chats').select('id, kind, name, request_id, created_by, is_default').eq('id', id!).maybeSingle();
    if (!data) { setMissing(true); return; }
    setChat(data);
    const { data: m } = await supabase.from('chat_members').select('user_id').eq('chat_id', id!);
    setMembers((m ?? []).map((x) => x.user_id));
    if (data.request_id) {
      const { data: r } = await supabase.from('requests').select('number, title').eq('id', data.request_id).single();
      setReq(r);
    }
  }
  useEffect(() => { load(); }, [id]);

  if (missing) return <p>This chat doesn't exist or you're not in it.</p>;
  if (!chat || !me) return <p>Loading…</p>;

  const canManage = chat.kind === 'group' && !chat.is_default &&
    (can('team.manage') || (can('chat.create_groups') && chat.created_by === me.id));
  const other = chat.kind === 'dm' ? person(members.find((m) => m !== me.id)) : undefined;
  const title = chat.kind === 'group' ? chat.name : chat.kind === 'dm' ? other?.full_name ?? 'Direct message' : `#${req?.number ?? ''} ${req?.title ?? ''}`;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <button className="btn btn-ghost px-3" onClick={() => nav('/chat')} aria-label="Back to chats">←</button>
        {other && <Avatar person={other} size={36} />}
        <div className="min-w-0 flex-1">
          <h1 className="h-display text-2xl truncate">{title}</h1>
          {chat.kind === 'group' && <div className="text-xs text-stone-500">{chat.is_default ? 'Everyone' : `${members.length} member${members.length === 1 ? '' : 's'}`}</div>}
          {chat.kind === 'request' && req && <Link to={`/r/${req.number}`} className="text-xs text-blue underline">Open request →</Link>}
        </div>
        {canManage && <button className="btn btn-ghost text-sm" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Members'}</button>}
      </div>

      {editing && <GroupSettings chat={chat} members={members} onSaved={() => { load(); reload(); }} />}

      <ChatThread chatId={chat.id} allowInternal={chat.kind === 'request'} />
    </div>
  );
}

export function GroupSettings({ chat, members, onSaved }: { chat: { id: string; name: string | null }; members: string[]; onSaved: () => void }) {
  const [name, setName] = useState(chat.name ?? '');
  const [sel, setSel] = useState(members);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => setSel(members), [members.join()]);

  async function save() {
    setError(''); setMsg('');
    if (name.trim() !== chat.name) {
      const { error } = await supabase.from('chats').update({ name: name.trim() }).eq('id', chat.id);
      if (error) { setError(error.message); return; }
    }
    const { error } = await supabase.rpc('set_group_members', { cid: chat.id, p_members: sel });
    if (error) setError(error.message); else { setMsg('Saved.'); onSaved(); }
  }
  return (
    <div className="card p-3 mb-4 space-y-3">
      <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
      <MemberPicker selected={sel} onChange={setSel} />
      <ErrorNote error={error} />
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      <button className="btn btn-primary w-full" onClick={save}>Save group ({sel.length} members)</button>
    </div>
  );
}
