// 🔔 / 🔕 for one chat: muted chats send no phone notifications (except @mentions).
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export default function MuteButton({ chatId, className = '' }: { chatId: string; className?: string }) {
  const { me } = useAuth();
  const [muted, setMuted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!me) return;
    supabase.from('chat_members').select('muted').eq('chat_id', chatId).eq('user_id', me.id).maybeSingle()
      .then(({ data }) => setMuted(!!data?.muted));
  }, [chatId, me?.id]);

  async function toggle() {
    const next = !muted;
    setMuted(next);
    const { error } = await supabase.rpc('set_chat_muted', { cid: chatId, p_muted: next });
    if (error) setMuted(!next);
  }

  if (muted === null) return null;
  return (
    <button type="button" onClick={toggle} className={`btn btn-ghost text-sm ${className}`}
      aria-pressed={muted} title={muted ? 'Muted: no phone notifications except @mentions' : 'Mute phone notifications for this chat'}>
      {muted ? '🔕 Muted' : '🔔 Mute'}
    </button>
  );
}
