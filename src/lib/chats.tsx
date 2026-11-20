// Keeps my chat list + unread counts fresh app-wide (for the Chat tab badge).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import type { ChatRow } from './types';

type ChatsCtx = { chats: ChatRow[]; totalUnread: number; reload: () => Promise<void> };
const Ctx = createContext<ChatsCtx>({ chats: [], totalUnread: 0, reload: async () => {} });
export const useChats = () => useContext(Ctx);

export function ChatsProvider({ children }: { children: ReactNode }) {
  const { me, can } = useAuth();
  const [chats, setChats] = useState<ChatRow[]>([]);
  const timer = useRef<number | undefined>(undefined);

  const reload = useCallback(async () => {
    const { data } = await supabase.rpc('chat_list');
    setChats((data as ChatRow[]) ?? []);
  }, []);

  useEffect(() => {
    if (!me) return;
    reload();
    // Any new message I can see → refresh the list (debounced).
    const ch = supabase.channel('chat-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(reload, 400);
      })
      .subscribe();
    // Also refresh when the app comes back to the foreground on a phone.
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onVisible); };
  }, [me?.id, reload]);

  const visible = can('section.chat') ? chats : chats.filter((c) => c.kind === 'request');
  const totalUnread = visible.reduce((n, c) => n + c.unread, 0);
  return <Ctx.Provider value={{ chats: visible, totalUnread, reload }}>{children}</Ctx.Provider>;
}
