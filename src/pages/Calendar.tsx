// Calendar: month / week / agenda. Shows calendar items (shoots, posts…)
// plus request due dates, submitted dates and event dates.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { CALENDAR_DOT, CALENDAR_STYLE, CALENDAR_TYPES } from '../lib/constants';
import { addDays, dayKey, parseDay, startOfWeek, timeLabel, useCalendar, type CalEvent } from '../lib/calendar';
import CalendarItemForm, { type CalendarDraft } from '../components/CalendarItemForm';
import { Avatar, PageHeader } from '../components/ui';

type View = 'month' | 'week' | 'agenda';
const VIEW_KEY = 'calendar.view';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FILTER_TYPES = [...CALENDAR_TYPES, 'Due', 'Submitted', 'Event'];

export default function Calendar() {
  const { can, team, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem(VIEW_KEY) as View) || 'month'; } catch { return 'month'; } });
  const focus = params.get('date') ? parseDay(params.get('date')!) : new Date();
  const [selected, setSelected] = useState(dayKey(focus));
  const [anchor, setAnchor] = useState(focus);
  const [hidden, setHidden] = useState<string[]>([]);
  const [person, setPerson] = useState('');
  const [editing, setEditing] = useState<CalendarDraft | null>(null);
  const [detail, setDetail] = useState<CalEvent | null>(null);

  // Visible range for each view
  const [from, to] = useMemo(() => {
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const s = startOfWeek(first);
      return [s, addDays(s, 41)];
    }
    if (view === 'week') { const s = startOfWeek(anchor); return [s, addDays(s, 6)]; }
    return [new Date(new Date().setHours(0, 0, 0, 0)), addDays(new Date(), 60)];
  }, [view, anchor]);

  const { events, reload } = useCalendar(from, to);
  const shown = events.filter((e) => !hidden.includes(e.type) && (!person || e.people.includes(person)));
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of shown) m.set(e.day, [...(m.get(e.day) ?? []), e]);
    return m;
  }, [shown]);

  function changeView(v: View) { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } }
  function shift(dir: -1 | 1) {
    const a = new Date(anchor);
    if (view === 'month') a.setMonth(a.getMonth() + dir); else a.setDate(a.getDate() + 7 * dir);
    setAnchor(a);
  }
  function goToday() { const t = new Date(); setAnchor(t); setSelected(dayKey(t)); setParams({}); }
  function open(e: CalEvent) {
    if (e.kind === 'item' && can('calendar.edit')) setEditing(e.item!);
    else setDetail(e);
  }

  const title = view === 'agenda' ? 'Next 60 days'
    : view === 'month' ? anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : `${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <div className="space-y-4">
      <PageHeader title="Calendar" right={
        can('calendar.edit') && <button className="btn btn-primary text-sm" onClick={() => setEditing({ date: selected })}>＋ New</button>
      } />

      {!can('calendar.view_all') && (
        <p className="text-xs text-stone-500 -mt-2">Showing your events: things you're scheduled for and your requests' dates.</p>
      )}

      {editing && <CalendarItemForm initial={editing} onDone={(c) => { setEditing(null); if (c) reload(); }} />}
      {detail && <EventDetail e={detail} onClose={() => setDetail(null)} />}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-line text-sm font-semibold">
          {(['month', 'week', 'agenda'] as View[]).map((v) => (
            <button key={v} onClick={() => changeView(v)} className={`px-3 py-1.5 capitalize ${view === v ? 'bg-ink text-cream' : 'bg-white'}`}>{v}</button>
          ))}
        </div>
        {view !== 'agenda' && (
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost !px-3 !py-1.5" onClick={() => shift(-1)} aria-label="Previous">‹</button>
            <button className="btn btn-ghost !px-3 !py-1.5 text-sm" onClick={goToday}>Today</button>
            <button className="btn btn-ghost !px-3 !py-1.5" onClick={() => shift(1)} aria-label="Next">›</button>
          </div>
        )}
        <span className="h-display text-xl ml-1">{title}</span>
      </div>

      <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1">
        {(can('calendar.view_all') || person) && (
          <select className="input !w-auto !py-1.5 shrink-0" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
            <option value="">Everyone</option>
            <option value={me!.id}>Just me</option>
            {team.filter((t) => t.active && t.id !== me!.id).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        )}
        {FILTER_TYPES.map((t) => {
          const on = !hidden.includes(t);
          return (
            <button key={t} onClick={() => setHidden(on ? [...hidden, t] : hidden.filter((x) => x !== t))}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold border ${on ? CALENDAR_STYLE[t] : 'bg-white text-stone-400 border-line line-through'}`}>
              {t}
            </button>
          );
        })}
      </div>

      {view === 'month' && (
        <>
          <div className="card overflow-hidden">
            <div className="grid grid-cols-7 text-center text-[11px] font-bold text-stone-500 border-b border-line">
              {WEEKDAYS.map((d) => <div key={d} className="py-1.5">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: 42 }, (_, i) => {
                const d = addDays(from, i);
                const k = dayKey(d);
                const list = byDay.get(k) ?? [];
                const other = d.getMonth() !== anchor.getMonth();
                const today = k === dayKey(new Date());
                return (
                  <button key={k} onClick={() => setSelected(k)}
                    className={`min-h-16 md:min-h-24 border-b border-r border-line p-1 text-left align-top ${other ? 'bg-stone-50 text-stone-400' : ''} ${selected === k ? 'ring-2 ring-blue ring-inset' : ''}`}>
                    <div className={`text-xs font-bold ${today ? 'bg-blue text-white rounded-full w-6 h-6 grid place-items-center' : ''}`}>{d.getDate()}</div>
                    {/* phones: colored dots; bigger screens: short labels */}
                    <div className="flex flex-wrap gap-0.5 mt-1 md:hidden">
                      {list.slice(0, 6).map((e) => <span key={e.key} className={`h-2 w-2 rounded-full ${CALENDAR_DOT[e.type] ?? 'bg-stone-400'}`} />)}
                    </div>
                    <div className="hidden md:block space-y-0.5 mt-1">
                      {list.slice(0, 3).map((e) => (
                        <div key={e.key} className={`truncate rounded px-1 text-[10px] font-semibold ${CALENDAR_STYLE[e.type] ?? ''}`}>{e.title}</div>
                      ))}
                      {list.length > 3 && <div className="text-[10px] text-stone-500">+{list.length - 3} more</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <DayList day={selected} events={byDay.get(selected) ?? []} onOpen={open}
            onAdd={can('calendar.edit') ? () => setEditing({ date: selected }) : undefined} />
        </>
      )}

      {view === 'week' && (
        <div className="space-y-2">
          {Array.from({ length: 7 }, (_, i) => dayKey(addDays(from, i))).map((k) => (
            <DayList key={k} day={k} events={byDay.get(k) ?? []} onOpen={open} compact
              onAdd={can('calendar.edit') ? () => setEditing({ date: k }) : undefined} />
          ))}
        </div>
      )}

      {view === 'agenda' && (
        <div className="space-y-2">
          {[...byDay.keys()].length === 0 && <p className="text-sm text-stone-500">Nothing coming up.</p>}
          {[...byDay.keys()].map((k) => <DayList key={k} day={k} events={byDay.get(k)!} onOpen={open} compact />)}
        </div>
      )}
    </div>
  );
}

export function DayList({ day, events, onOpen, onAdd, compact }: {
  day: string; events: CalEvent[]; onOpen: (e: CalEvent) => void; onAdd?: () => void; compact?: boolean;
}) {
  const { person } = useAuth();
  const d = parseDay(day);
  const today = day === dayKey(new Date());
  return (
    <section className="card p-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className={`font-bold text-sm ${today ? 'text-blue' : ''}`}>
          {today ? 'Today · ' : ''}{d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </h3>
        {onAdd && <button className="text-xs text-blue font-semibold" onClick={onAdd}>＋ Add</button>}
      </div>
      {events.length === 0 ? <p className="text-xs text-stone-400">{compact ? 'Nothing scheduled' : 'Nothing on this day.'}</p> : (
        <ul className="space-y-1.5">
          {events.map((e) => (
            <li key={e.key}>
              <button className="w-full flex items-center gap-2 text-left" onClick={() => onOpen(e)}>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${CALENDAR_STYLE[e.type] ?? ''}`}>{e.type}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{e.title}</span>
                  <span className="block text-[11px] text-stone-500">{timeLabel(e)}{e.item?.location ? ` · ${e.item.location}` : ''}</span>
                </span>
                <span className="flex -space-x-1.5 shrink-0">{e.people.slice(0, 4).map((p) => <Avatar key={p} person={person(p)} size={20} />)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EventDetail({ e, onClose }: { e: CalEvent; onClose: () => void }) {
  const { person } = useAuth();
  return (
    <section className="card p-4 space-y-2 border-blue">
      <div className="flex justify-between gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${CALENDAR_STYLE[e.type] ?? ''}`}>{e.type}</span>
        <button className="text-sm text-stone-500" onClick={onClose}>✕ Close</button>
      </div>
      <h2 className="font-bold text-lg">{e.title}</h2>
      <p className="text-sm text-stone-600">
        {e.start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {timeLabel(e)}
        {e.item?.location ? ` · ${e.item.location}` : ''}
      </p>
      {e.item?.notes && <p className="text-sm whitespace-pre-wrap">{e.item.notes}</p>}
      {e.item?.caption_draft && <p className="text-sm whitespace-pre-wrap bg-cream rounded-lg p-2"><b>Caption:</b> {e.item.caption_draft}</p>}
      {e.people.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {e.people.map((p) => <span key={p} className="flex items-center gap-1"><Avatar person={person(p)} size={20} />{person(p)?.full_name}</span>)}
        </div>
      )}
      {e.link && <Link to={e.link} className="text-sm text-blue underline">Open request →</Link>}
    </section>
  );
}
