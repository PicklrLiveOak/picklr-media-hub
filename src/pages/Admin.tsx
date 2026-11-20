// Admin dashboard: overview, people & permissions, group chats, activity log.
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { STATUSES } from '../lib/constants';
import { fmtDateTime, todayISO } from '../lib/format';
import type { Activity, SocialAccount } from '../lib/types';
import Team from './Team';
import AdminAccess from './AdminAccess';
import AdminSetup from './AdminSetup';
import { GroupSettings } from './ChatRoom';
import { NewGroup } from './Chats';
import { Avatar, PageHeader, StatusChip, TokenWarning } from '../components/ui';

const TABS = ['overview', 'people', 'access', 'setup', 'chats', 'activity'] as const;
type Tab = (typeof TABS)[number];

export default function Admin() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'overview') as Tab;

  return (
    <div>
      <PageHeader title="Admin" />
      <div className="flex gap-1 mb-5 overflow-x-auto -mx-4 px-4 pb-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setParams({ tab: t })}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold capitalize shrink-0 ${tab === t ? 'bg-ink text-cream' : 'bg-white border border-line'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'people' && <Team />}
      {tab === 'access' && <AdminAccess />}
      {tab === 'setup' && <AdminSetup />}
      {tab === 'chats' && <GroupChats />}
      {tab === 'activity' && <ActivityLog />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Overview() {
  const { team } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [overdue, setOverdue] = useState(0);
  const [dueSoon, setDueSoon] = useState(0);
  const [msgs, setMsgs] = useState(0);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [recent, setRecent] = useState<Activity[]>([]);

  useEffect(() => {
    (async () => {
      const { data: reqs } = await supabase.from('requests').select('status, needed_by');
      const c: Record<string, number> = {};
      const today = todayISO();
      const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
      let od = 0, ds = 0;
      for (const r of reqs ?? []) {
        c[r.status] = (c[r.status] ?? 0) + 1;
        const open = !['Posted', 'On Hold'].includes(r.status);
        if (open && r.needed_by && r.needed_by < today) od++;
        else if (open && r.needed_by && r.needed_by <= week) ds++;
      }
      setCounts(c); setOverdue(od); setDueSoon(ds);
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', since);
      setMsgs(count ?? 0);
      setAccounts(((await supabase.from('social_accounts').select('*')).data as SocialAccount[]) ?? []);
      setRecent(((await supabase.from('activity_log').select('*').order('at', { ascending: false }).limit(8)).data as Activity[]) ?? []);
    })();
  }, []);

  const open = STATUSES.filter((s) => s !== 'Posted').reduce((n, s) => n + (counts[s] ?? 0), 0);
  return (
    <div className="space-y-5">
      <TokenWarning accounts={accounts} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Open requests" value={open} to="/board" />
        <Stat label="Overdue" value={overdue} tone={overdue ? 'bad' : undefined} to="/board" />
        <Stat label="Due in 7 days" value={dueSoon} to="/board" />
        <Stat label="Active people" value={team.filter((t) => t.active).length} to="/admin?tab=people" />
      </div>

      <section className="card p-4">
        <h2 className="h-display text-lg mb-3">Requests by status</h2>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-sm"><StatusChip status={s} /> <b>{counts[s] ?? 0}</b></span>
          ))}
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-3">
        <section className="card p-4">
          <h2 className="h-display text-lg mb-2">Social accounts</h2>
          {accounts.length === 0 ? (
            <p className="text-sm text-stone-600">Not connected yet. <Link to="/insights" className="text-blue underline">Connect on the Insights page →</Link></p>
          ) : accounts.map((a) => (
            <div key={a.platform} className="text-sm py-1">
              <b className="capitalize">{a.platform}</b> · {a.username ? `@${a.username}` : a.name} · {a.followers?.toLocaleString() ?? '—'} followers
              <div className={`text-xs ${a.last_error ? 'text-red-600' : 'text-stone-500'}`}>
                {a.last_error ? `Last sync failed: ${a.last_error}` : a.last_synced_at ? `Synced ${fmtDateTime(a.last_synced_at)}` : 'Not synced yet'}
              </div>
              <div className={`text-xs ${a.token_status === 'ok' ? 'text-emerald-700' : a.token_status === 'unknown' ? 'text-stone-500' : 'text-red-600'}`}>
                Token: {a.token_message ?? 'not checked yet'}
              </div>
            </div>
          ))}
        </section>
        <section className="card p-4">
          <h2 className="h-display text-lg mb-2">Chat this week</h2>
          <p className="text-3xl font-bold">{msgs}</p>
          <p className="text-xs text-stone-500">messages in group chats and request threads (DMs stay private)</p>
          <Link to="/admin?tab=chats" className="text-sm text-blue underline mt-2 inline-block">Manage group chats →</Link>
        </section>
      </div>

      <section className="card p-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="h-display text-lg">Recent activity</h2>
          <Link to="/admin?tab=activity" className="text-sm text-blue underline">See all →</Link>
        </div>
        <ActivityList rows={recent} />
      </section>
    </div>
  );
}

function Stat({ label, value, to, tone }: { label: string; value: number; to: string; tone?: 'bad' }) {
  return (
    <Link to={to} className="card p-3 hover:border-blue">
      <div className="text-xs font-semibold text-stone-500">{label}</div>
      <div className={`text-3xl font-bold ${tone === 'bad' ? 'text-red-600' : ''}`}>{value}</div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
type GroupRow = { id: string; name: string | null; created_at: string; members: string[]; is_default: boolean };

function GroupChats() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { person } = useAuth();

  const load = useCallback(async () => {
    const { data } = await supabase.from('chats').select('id, name, created_at, is_default, chat_members(user_id)')
      .eq('kind', 'group').order('is_default', { ascending: false }).order('name');
    setGroups((data ?? []).map((g: { id: string; name: string | null; created_at: string; is_default: boolean; chat_members: { user_id: string }[] }) =>
      ({ ...g, members: g.chat_members.map((m) => m.user_id) })));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function remove(g: GroupRow) {
    if (!confirm(`Delete the group "${g.name}" and all its messages? This cannot be undone.`)) return;
    const { error } = await supabase.from('chats').delete().eq('id', g.id);
    if (error) alert(error.message); else load();
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex justify-between items-center gap-3">
        <p className="text-sm text-stone-600">Every group chat. DMs stay private between the people in them.</p>
        <button className="btn btn-primary text-sm shrink-0" onClick={() => setCreating(!creating)}>{creating ? 'Close' : '＋ New group'}</button>
      </div>
      {creating && <NewGroup onClose={() => { setCreating(false); load(); }} />}
      {groups.map((g) => (
        <div key={g.id} className="card">
          <button className="w-full flex items-center gap-3 p-3 text-left" onClick={() => setOpen(open === g.id ? null : g.id)}>
            <span className="grid place-items-center h-10 w-10 rounded-full bg-blue text-white text-lg shrink-0">#</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate">{g.name}{g.is_default && <span className="ml-2 text-[10px] font-bold uppercase bg-cream border border-line rounded-full px-2 py-0.5">Everyone</span>}</div>
              <div className="flex -space-x-1.5 mt-1">
                {g.members.slice(0, 10).map((m) => <Avatar key={m} person={person(m)} size={20} />)}
                {g.members.length === 0 && <span className="text-xs text-amber-700">No members yet — tap to add people</span>}
                {g.members.length > 10 && <span className="text-xs pl-3">+{g.members.length - 10}</span>}
              </div>
            </div>
            <span className="text-stone-400">{open === g.id ? '▴' : '▾'}</span>
          </button>
          {open === g.id && g.is_default && (
            <div className="border-t border-line p-3 text-sm text-stone-600">
              Everyone is in General automatically, including new accounts the moment you create them.
              <div className="mt-2"><Link to={`/chat/${g.id}`} className="text-blue underline">Open chat →</Link></div>
            </div>
          )}
          {open === g.id && !g.is_default && (
            <div className="border-t border-line p-3">
              <GroupSettings chat={g} members={g.members} onSaved={load} />
              <div className="flex justify-between">
                <Link to={`/chat/${g.id}`} className="text-sm text-blue underline">Open chat →</Link>
                <button className="text-sm text-red-600 underline" onClick={() => remove(g)}>Delete group</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
const FILTERS: [string, string][] = [['', 'Everything'], ['request.', 'Requests'], ['user.', 'People & permissions'], ['chat.', 'Chats'], ['insights.', 'Insights']];

function ActivityLog() {
  const { team } = useAuth();
  const [rows, setRows] = useState<Activity[]>([]);
  const [kind, setKind] = useState('');
  const [who, setWho] = useState('');
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    let q = supabase.from('activity_log').select('*').order('at', { ascending: false }).limit(limit);
    if (kind) q = q.like('action', `${kind}%`);
    if (who) q = q.eq('actor_id', who);
    q.then(({ data }) => setRows((data as Activity[]) ?? []));
  }, [kind, who, limit]);

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex gap-2 flex-wrap">
        <select className="input !w-auto max-w-full min-w-0" value={kind} onChange={(e) => setKind(e.target.value)}>
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="input !w-auto max-w-full min-w-0" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Anyone</option>
          {team.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
        </select>
      </div>
      <div className="card p-3"><ActivityList rows={rows} /></div>
      {rows.length === limit && <button className="btn btn-ghost w-full" onClick={() => setLimit(limit + 100)}>Load more</button>}
    </div>
  );
}

function ActivityList({ rows }: { rows: Activity[] }) {
  const { person } = useAuth();
  if (!rows.length) return <p className="text-sm text-stone-500">Nothing logged yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((a) => {
        const actor = person(a.actor_id);
        const details = a.details as { added?: string[]; removed?: string[] } | null;
        return (
          <li key={a.id} className="py-2 flex gap-3">
            <Avatar person={actor} size={28} />
            <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
              <div><b>{actor?.full_name ?? (a.source === 'system' ? 'System' : a.source === 'mcp' ? 'Claude' : 'Someone')}</b> · {a.summary}</div>
              {details?.added?.length ? <div className="text-xs text-emerald-700">+ {details.added.join(', ')}</div> : null}
              {details?.removed?.length ? <div className="text-xs text-red-600">− {details.removed.join(', ')}</div> : null}
              <div className="text-[11px] text-stone-500">{fmtDateTime(a.at)}{a.source !== 'app' ? ` · ${a.source}` : ''}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
