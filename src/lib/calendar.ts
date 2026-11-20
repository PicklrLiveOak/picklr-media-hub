// Calendar data: real calendar items + dates pulled from requests
// (due dates, submitted dates, event dates), merged into one list.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import type { CalendarItem, MediaRequest } from './types';

export type CalEvent = {
  key: string;
  kind: 'item' | 'Due' | 'Submitted' | 'Event';
  type: string;               // calendar type, or Due / Submitted / Event
  title: string;
  day: string;                // YYYY-MM-DD (local)
  start: Date;
  end: Date | null;
  allDay: boolean;
  people: string[];
  link?: string;              // request page for request-derived events
  item?: CalendarItem;
};

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = (d: Date) => addDays(d, -d.getDay()); // weeks start Sunday

/** Loads everything between `from` and `to` (inclusive local days). */
export function useCalendar(from: Date, to: Date) {
  const { me, can } = useAuth();
  const all = can('calendar.view_all'); // plain boolean so the loader doesn't re-run every render
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const fromKey = dayKey(from), toKey = dayKey(to);

  const load = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    const start = parseDay(fromKey), end = addDays(parseDay(toKey), 1);
    const [items, reqs] = await Promise.all([
      supabase.from('calendar_items').select('*, calendar_assignees(user_id)')
        .gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).order('starts_at'),
      supabase.from('requests').select('id, number, title, needed_by, event_date, event_name, created_at, requester_id, created_by, status, request_assignees(user_id)')
        .or(`needed_by.gte.${fromKey},event_date.gte.${fromKey},created_at.gte.${start.toISOString()}`),
    ]);
    const out: CalEvent[] = [];
    for (const it of (items.data as CalendarItem[]) ?? []) {
      const s = new Date(it.starts_at);
      out.push({
        key: it.id, kind: 'item', type: it.type, title: it.title, day: dayKey(s), start: s,
        end: it.ends_at ? new Date(it.ends_at) : null, allDay: it.all_day,
        people: (it.calendar_assignees ?? []).map((a) => a.user_id), item: it,
      });
    }
    // Request dates: everyone sees their own; "see everyone's calendar" sees all requests they can open
    for (const r of (reqs.data as MediaRequest[]) ?? []) {
      const mine = r.requester_id === me.id || r.created_by === me.id || r.request_assignees?.some((a) => a.user_id === me.id);
      if (!all && !mine) continue;
      const people = [r.requester_id, ...(r.request_assignees ?? []).map((a) => a.user_id)];
      const link = `/r/${r.number}`;
      if (r.needed_by && r.needed_by >= fromKey && r.needed_by <= toKey && r.status !== 'Posted') {
        out.push({ key: `due-${r.id}`, kind: 'Due', type: 'Due', title: `Due: #${r.number} ${r.title}`, day: r.needed_by,
          start: parseDay(r.needed_by), end: null, allDay: true, people, link });
      }
      if (r.event_date && r.event_date >= fromKey && r.event_date <= toKey) {
        out.push({ key: `ev-${r.id}`, kind: 'Event', type: 'Event', title: `${r.event_name || 'Event'} (#${r.number})`, day: r.event_date,
          start: parseDay(r.event_date), end: null, allDay: true, people, link });
      }
      const sub = new Date(r.created_at);
      const subKey = dayKey(sub);
      if (subKey >= fromKey && subKey <= toKey) {
        out.push({ key: `sub-${r.id}`, kind: 'Submitted', type: 'Submitted', title: `Submitted: #${r.number} ${r.title}`, day: subKey,
          start: sub, end: null, allDay: false, people, link });
      }
    }
    out.sort((a, b) => a.day.localeCompare(b.day) || Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
    setEvents(out);
    setLoading(false);
  }, [me?.id, fromKey, toKey, all]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`cal-${fromKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_items' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, fromKey]);

  return { events, loading, reload: load };
}

export const timeLabel = (e: CalEvent) =>
  e.allDay ? 'All day' : `${e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${e.end ? `–${e.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}`;
