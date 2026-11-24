import { createClient } from '@supabase/supabase-js';

// Both values are public (safe in the browser). RLS in the database is what
// actually protects data. They come from .env.local locally and from GitHub
// repository variables when deployed.
const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !anonKey) console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');

// "Remember me" on the sign-in page: on = stay signed in (localStorage);
// off = signed out once the app/browser is closed (sessionStorage).
const REMEMBER_KEY = 'picklr.remember';
const safe = <T,>(fn: () => T, fallback: T) => { try { return fn(); } catch { return fallback; } };
export const getRememberMe = () => safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true);
export const setRememberMe = (on: boolean) => safe(() => localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'), undefined);

const authStorage = {
  getItem: (k: string) => safe(() => localStorage.getItem(k) ?? sessionStorage.getItem(k), null),
  setItem: (k: string, v: string) => safe(() => {
    const [keep, drop] = getRememberMe() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
    keep.setItem(k, v); drop.removeItem(k);
  }, undefined),
  removeItem: (k: string) => safe(() => { localStorage.removeItem(k); sessionStorage.removeItem(k); }, undefined),
};

export const supabase = createClient(url, anonKey, { auth: { storage: authStorage, persistSession: true } });

// Staff sign in with a username. Supabase needs an email, so each username
// maps to a placeholder address that never receives mail.
// Must match LOGIN_EMAIL_DOMAIN in supabase/functions/admin-users/index.ts
export const LOGIN_EMAIL_DOMAIN = 'staff.picklr-hub.example.com';
export const usernameToEmail = (username: string) =>
  `${username.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;
