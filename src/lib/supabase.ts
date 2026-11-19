import { createClient } from '@supabase/supabase-js';

// Both values are public (safe in the browser). RLS in the database is what
// actually protects data. They come from .env.local locally and from GitHub
// repository variables when deployed.
const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !anonKey) console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');

export const supabase = createClient(url, anonKey);

// Staff sign in with a username. Supabase needs an email, so each username
// maps to a placeholder address that never receives mail.
// Must match LOGIN_EMAIL_DOMAIN in supabase/functions/admin-users/index.ts
export const LOGIN_EMAIL_DOMAIN = 'staff.picklr-hub.example.com';
export const usernameToEmail = (username: string) =>
  `${username.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;
