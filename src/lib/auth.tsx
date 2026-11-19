// Holds "who am I" plus small lookup lists (team, departments, role presets)
// that almost every page needs. The team is under a dozen people, so loading
// everyone once is simpler than joining names in every query.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Department, Profile, RolePreset } from './types';

type AuthCtx = {
  session: Session | null;
  loading: boolean;
  me: Profile | null;
  team: Profile[];
  departments: Department[];
  presets: RolePreset[];
  can: (permission: string) => boolean;
  person: (id: string | null | undefined) => Profile | undefined;
  deptName: (id: number | null | undefined) => string;
  reload: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [presets, setPresets] = useState<RolePreset[]>([]);

  const reload = useCallback(async () => {
    const [p, d, r] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('departments').select('*').order('sort'),
      supabase.from('role_presets').select('*'),
    ]);
    setTeam((p.data as Profile[]) ?? []);
    setDepartments((d.data as Department[]) ?? []);
    setPresets((r.data as RolePreset[]) ?? []);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setTeam([]); setLoading(false); return; }
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [session?.user.id, reload]);

  const me = team.find((t) => t.id === session?.user.id) ?? null;

  // Mirrors has_perm() in the database. The UI uses it only to hide buttons —
  // the database is what actually enforces it.
  const can = (permission: string) =>
    !!me && me.active && (me.role === 'admin' || me.permissions.includes(permission));

  const person = (id: string | null | undefined) => team.find((t) => t.id === id);
  const deptName = (id: number | null | undefined) => departments.find((d) => d.id === id)?.name ?? '';

  return (
    <Ctx.Provider value={{ session, loading, me, team, departments, presets, can, person, deptName, reload }}>
      {children}
    </Ctx.Provider>
  );
}
