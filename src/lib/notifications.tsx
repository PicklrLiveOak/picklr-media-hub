// In-app notifications (new requests for Strategy, approvals for Execution,
// status changes, calendar invites, @mentions). Live via Realtime.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import type { Notice } from './types';

type Ctx = { notices: Notice[]; unread: number; markRead: (ids?: number[]) => Promise<void>; reload: () => Promise<void> };
const NoticeCtx = createContext<Ctx>({ notices: [], unread: 0, markRead: async () => {}, reload: async () => {} });
export const useNotifications = () => useContext(NoticeCtx);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [notices, setNotices] = useState<Notice[]>([]);

  const reload = useCallback(async () => {
    if (!me) return;
    const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    setNotices((data as Notice[]) ?? []);
  }, [me?.id]);

  useEffect(() => {
    if (!me) return;
    reload();
    const ch = supabase.channel('notices')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.id}` }, () => reload())
      .subscribe();
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', onVisible); };
  }, [me?.id, reload]);

  /** Mark some (or all) as read. */
  const markRead = async (ids?: number[]) => {
    const target = ids ?? notices.filter((n) => !n.read_at).map((n) => n.id);
    if (!target.length) return;
    setNotices((ns) => ns.map((n) => (target.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)));
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', target);
  };

  const unread = notices.filter((n) => !n.read_at).length;
  return <NoticeCtx.Provider value={{ notices, unread, markRead, reload }}>{children}</NoticeCtx.Provider>;
}

export const NOTICE_ICON: Record<string, string> = {
  'request.new': '📥', 'request.approved': '✅', 'request.status': '🔄', 'calendar.assigned': '📅', 'request.assigned': '🙋', 'chat.mention': '💬',
};
