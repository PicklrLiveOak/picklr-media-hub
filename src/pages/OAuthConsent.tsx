// "Connect Claude" approval page. Supabase Auth sends people here (via
// public/oauth-consent.html) when they add Media Hub as a connector in Claude.
// They're already signed in to Media Hub (the app shows the login first if not).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { ErrorNote } from '../components/ui';

type Details = { authorization_id?: string; redirect_url?: string; redirect_uri?: string; scope?: string; client?: { name?: string } };

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const id = params.get('authorization_id') ?? '';
  const { me, can } = useAuth();
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = can('claude.connect');

  useEffect(() => {
    if (!id) { setError('This link is missing its authorization id. Start again from the Claude app.'); return; }
    supabase.auth.oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (error) { setError(error.message); return; }
      const d = data as Details;
      if (!d.authorization_id && d.redirect_url) { window.location.href = d.redirect_url; return; } // already approved
      setDetails(d);
    });
  }, [id]);

  async function decide(approve: boolean) {
    setBusy(true); setError('');
    const { data, error } = approve
      ? await supabase.auth.oauth.approveAuthorization(id)
      : await supabase.auth.oauth.denyAuthorization(id);
    if (error) { setError(error.message); setBusy(false); return; }
    window.location.href = (data as { redirect_url: string }).redirect_url;
  }

  const client = details?.client?.name || 'Claude';
  return (
    <div className="min-h-dvh bg-ink text-cream grid place-items-center px-6 pt-safe pb-safe">
      <div className="w-full max-w-sm space-y-4">
        <img src="picklr-mark.png" alt="" className="w-14 h-14 mx-auto" />
        <h1 className="h-display text-3xl text-center">Connect <span className="text-blue">{client}</span></h1>
        {!details && !error && <p className="text-center text-cream/70">Loading…</p>}
        {details && (
          <>
            <div className="card text-ink p-4 space-y-2 text-sm">
              <p><b>{client}</b> wants to use Picklr Media Hub as <b>{me?.full_name}</b>.</p>
              <ul className="list-disc pl-5 space-y-1 text-stone-700">
                <li>See what you can see: requests, chats, calendar, insights</li>
                <li>Act for you when you ask: update requests, write briefs/scripts, schedule, send chats (tagged “via Claude”)</li>
                <li>Everything it does goes in the activity log</li>
              </ul>
              <p className="text-xs text-stone-500 break-all">Returns to: {details.redirect_uri}</p>
            </div>
            {!allowed && <p className="text-sm text-amber-300">You don't have the “Use Claude as an assistant” permission yet. Ask the admin to turn it on.</p>}
            <button className="btn btn-primary w-full" disabled={busy || !allowed} onClick={() => decide(true)}>Approve</button>
            <button className="btn w-full border border-cream/30" disabled={busy} onClick={() => decide(false)}>Deny</button>
          </>
        )}
        <ErrorNote error={error} />
        <p className="text-xs text-cream/50 text-center">You can disconnect any time in the Claude app's connector settings.</p>
      </div>
    </div>
  );
}
