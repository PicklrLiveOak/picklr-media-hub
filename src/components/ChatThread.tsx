// A live conversation: messages + composer with @mentions, photos and links.
// Used by the Chat screen and by each request's comment thread.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '../lib/auth';
import { useChats } from '../lib/chats';
import { supabase } from '../lib/supabase';
import { fmtDateTime } from '../lib/format';
import { prepareFile, signedUrl, uploadFile } from '../lib/upload';
import type { Message, Profile } from '../lib/types';
import { Avatar } from './ui';

const MENTION_RE = /@([a-z0-9._-]+)/gi;

export default function ChatThread({ chatId, allowInternal = false, compact = false }: {
  chatId: string; allowInternal?: boolean; compact?: boolean;
}) {
  const { me, team, person, can } = useAuth();
  const { reload: reloadList } = useChats();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [caret, setCaret] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const canInternal = allowInternal && can('requests.internal');

  const load = useCallback(async () => {
    const { data } = await supabase.from('messages').select('*').eq('chat_id', chatId)
      .order('created_at', { ascending: false }).limit(150);
    setMessages(((data as Message[]) ?? []).reverse());
    await supabase.rpc('mark_read', { cid: chatId });
    reloadList();
  }, [chatId, reloadList]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`chat-${chatId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [chatId, load]);

  // Jump to the newest message. Embedded boxes (Home, request comments) scroll
  // only inside themselves so the page doesn't jump down.
  useEffect(() => {
    if (compact) { if (list.current) list.current.scrollTop = list.current.scrollHeight; }
    else bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, compact]);

  // @mention autocomplete: look at the word right before the cursor.
  const mentionQuery = useMemo(() => {
    const m = text.slice(0, caret).match(/(?:^|\s)@([a-z0-9._-]*)$/i);
    return m ? m[1].toLowerCase() : null;
  }, [text, caret]);
  const suggestions = mentionQuery === null ? [] : team
    .filter((t) => t.active && t.id !== me?.id &&
      (t.username.includes(mentionQuery) || t.full_name.toLowerCase().includes(mentionQuery)))
    .slice(0, 6);

  function pickMention(p: Profile) {
    const before = text.slice(0, caret).replace(/@([a-z0-9._-]*)$/i, `@${p.username} `);
    const next = before + text.slice(caret);
    setText(next);
    setCaret(before.length);
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(before.length, before.length); });
  }

  async function send() {
    const body = text.trim();
    if (!body && !file) return;
    setBusy(true); setError('');
    try {
      const mentions = [...new Set([...body.matchAll(MENTION_RE)]
        .map((m) => team.find((t) => t.username === m[1].toLowerCase())?.id).filter(Boolean))] as string[];
      let attachment_path: string | null = null;
      if (file) attachment_path = await uploadFile(`chat/${chatId}`, await prepareFile(file));
      const link = body.match(/https?:\/\/\S+/)?.[0] ?? null;
      const { error } = await supabase.from('messages').insert({
        chat_id: chatId, body, mentions, attachment_path, link_url: link, internal: canInternal && internal,
      });
      if (error) throw error;
      setText(''); setFile(null); setInternal(false);
      if (box.current) box.current.style.height = ''; // shrink back to one line
      load();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function remove(m: Message) {
    if (!confirm('Delete this message?')) return;
    if (m.attachment_path) await supabase.storage.from('uploads').remove([m.attachment_path]);
    await supabase.from('messages').delete().eq('id', m.id);
    load();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(suggestions[0]); return; }
    // Enter sends on a computer; on phones Enter makes a new line and you tap Send.
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) { e.preventDefault(); send(); }
  }

  return (
    // Full-screen chat: messages fill the space and the composer stays pinned
    // above the tab bar. On a request page (compact) it's a scrolling box.
    <div className={`flex flex-col ${compact ? '' : 'min-h-[calc(100dvh-14rem)]'}`}>
      <div ref={list} className={`space-y-3 flex-1 ${compact ? 'max-h-[28rem] overflow-y-auto pr-1' : ''}`}>
        {messages.length === 0 && <p className="text-sm text-stone-500 py-4 text-center">No messages yet — say hi 👋</p>}
        {messages.map((m, i) => {
          const mine = m.author_id === me?.id;
          const author = person(m.author_id);
          const showName = i === 0 || messages[i - 1].author_id !== m.author_id || messages[i - 1].via !== m.via;
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              <div className="w-7 shrink-0">{showName && !mine && <Avatar person={author} size={28} />}</div>
              <div className={`max-w-[80%] min-w-0 ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                {showName && (
                  <div className="text-[11px] text-stone-500 mb-0.5">
                    {mine ? 'You' : author?.full_name ?? 'Someone'}{m.via === 'claude' && ' · via Claude ✳︎'} · {fmtDateTime(m.created_at)}
                  </div>
                )}
                <div className={`rounded-2xl px-3 py-2 text-[15px] break-words whitespace-pre-wrap ${
                  m.internal ? 'bg-amber-100 text-amber-950 border border-amber-300'
                  : mine ? 'bg-blue text-white' : 'bg-white border border-line'}`}>
                  {m.internal && <div className="text-[10px] font-bold uppercase tracking-wide mb-0.5">🔒 Media team only</div>}
                  {m.body && <MessageText body={m.body} mine={mine && !m.internal} />}
                  {m.attachment_path && <ChatImage path={m.attachment_path} />}
                </div>
                {(mine || me?.role === 'admin') && (
                  <button className="text-[11px] text-stone-400 mt-0.5" onClick={() => remove(m)}>delete</button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {/* Composer */}
      <div className={`relative mt-3 ${compact ? '' : 'sticky bottom-above-tabbar bg-cream pt-2 pb-2 z-10'}`}>
        {suggestions.length > 0 && (
          <ul className="absolute bottom-full mb-1 left-0 right-0 card shadow-lg overflow-hidden z-10">
            {suggestions.map((p) => (
              <li key={p.id}>
                <button type="button" className="w-full flex items-center gap-2 px-3 py-2 hover:bg-cream text-left"
                  onMouseDown={(e) => { e.preventDefault(); pickMention(p); }}>
                  <Avatar person={p} size={24} /> <span className="font-semibold">{p.full_name}</span>
                  <span className="text-stone-500 text-sm">@{p.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {file && (
          <div className="mb-2 text-sm flex items-center gap-2">📎 <span className="truncate">{file.name}</span>
            <button className="text-red-600" onClick={() => setFile(null)}>remove</button></div>
        )}
        {canInternal && (
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            🔒 Internal note (hidden from the requester)
          </label>
        )}
        <div className="flex items-end gap-2">
          <label className="btn btn-ghost px-3 shrink-0 cursor-pointer" aria-label="Attach photo">
            📷<input type="file" accept="image/*" className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </label>
          <textarea ref={box} rows={1} className="input resize-none max-h-40 min-h-[2.9rem]" placeholder="Message…"
            value={text} onKeyDown={onKey}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }} />
          <button className="btn btn-primary shrink-0" disabled={busy || (!text.trim() && !file)} onClick={send}>
            {busy ? '…' : 'Send'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
      </div>
    </div>
  );
}

/** Highlights @mentions and makes links clickable. */
function MessageText({ body, mine }: { body: string; mine: boolean }) {
  const parts = body.split(/(@[a-z0-9._-]+|https?:\/\/\S+)/gi);
  return (
    <>
      {parts.map((p, i) => {
        if (/^@/.test(p)) return <span key={i} className={`font-bold ${mine ? 'underline' : 'text-blue'}`}>{p}</span>;
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" className="underline break-all">{p}</a>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function ChatImage({ path }: { path: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { signedUrl(path).then(setUrl); }, [path]);
  if (!url) return <div className="h-32 w-48 bg-stone-200 rounded-lg animate-pulse mt-1" />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="attachment" className="mt-1 rounded-lg max-h-64 max-w-full object-cover" />
    </a>
  );
}
