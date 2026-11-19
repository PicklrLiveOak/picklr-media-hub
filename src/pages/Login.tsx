import { useState, type FormEvent } from 'react';
import { supabase, usernameToEmail } from '../lib/supabase';
import { ErrorNote } from '../components/ui';

export default function Login({ note }: { note?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(note ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong username or password.' : error.message);
    setBusy(false);
  }

  return (
    <div className="min-h-dvh bg-ink text-cream grid place-items-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <img src="logo.svg" alt="" className="w-20 h-20 mx-auto" />
        <h1 className="h-display text-4xl text-center">Picklr <span className="text-blue">Media Hub</span></h1>
        <p className="text-center text-cream/70 text-sm">The Picklr Live Oak · Media Department</p>
        <input className="input text-ink" placeholder="Username" autoCapitalize="none" autoCorrect="off"
          autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input className="input text-ink" type="password" placeholder="Password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
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
