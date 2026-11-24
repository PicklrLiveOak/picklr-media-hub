import { useState, type FormEvent } from 'react';
import { getRememberMe, setRememberMe, supabase, usernameToEmail } from '../lib/supabase';

const USERNAME_KEY = 'picklr.username';
const savedUsername = () => { try { return localStorage.getItem(USERNAME_KEY) ?? ''; } catch { return ''; } };
import { ErrorNote } from '../components/ui';

export default function Login({ note }: { note?: string }) {
  const [username, setUsername] = useState(savedUsername);
  const [remember, setRemember] = useState(getRememberMe);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(note ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    setRememberMe(remember); // decides where the session is kept (see lib/supabase.ts)
    try {
      if (remember) localStorage.setItem(USERNAME_KEY, username.trim().toLowerCase());
      else localStorage.removeItem(USERNAME_KEY);
    } catch { /* private mode */ }
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong username or password.' : error.message);
    setBusy(false);
  }

  return (
    <div className="min-h-dvh bg-ink text-cream grid place-items-center px-6 pt-safe pb-safe">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <img src="picklr-mark.png" alt="" className="w-16 h-16 mx-auto" />
        <img src="picklr-wordmark-white.png" alt="Picklr" className="h-9 w-auto mx-auto" />
        <h1 className="h-display text-4xl text-center text-blue -mt-1">Media Hub</h1>
        <p className="text-center text-cream/70 text-sm">The Picklr Live Oak · Media Department</p>
        <input className="input text-ink" placeholder="Username" autoCapitalize="none" autoCorrect="off"
          autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input className="input text-ink" type="password" placeholder="Password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        <label className="flex items-center gap-2.5 text-sm text-cream/90 cursor-pointer select-none">
          <input type="checkbox" className="h-5 w-5 accent-[#0075E7]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember me
        </label>
        <ErrorNote error={error} />
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {note && (
          <button type="button" className="text-sm underline w-full" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        )}
      </form>
    </div>
  );
}
