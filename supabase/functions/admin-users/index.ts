// admin-users — the only place accounts are created or locked.
//
// Why an Edge Function? Creating users needs the Supabase *service role* key,
// which must never be in the browser. This function holds it (Supabase injects
// it automatically) and first checks that the caller has `team.manage`.
//
// Actions (POST JSON body):
//   { action: "create", username, password, full_name, role, department_id?, phone?, contact_email? }
//   { action: "reset_password", user_id, password }
//   { action: "set_active", user_id, active }
import { createClient } from 'npm:@supabase/supabase-js@2';

// Must match LOGIN_EMAIL_DOMAIN in src/lib/supabase.ts
const LOGIN_EMAIL_DOMAIN = 'staff.picklr-hub.example.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  // 1) Who is calling? Use their own token so has_perm() sees them.
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: allowed } = await caller.rpc('has_perm', { p: 'team.manage' });
  if (!allowed) return reply({ error: 'Only the admin can manage accounts.' }, 403);
  const { data: me } = await caller.auth.getUser();
  const callerId = me.user?.id;

  // 2) Do the privileged work with the service role.
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));

  try {
    if (body.action === 'create') {
      const username = String(body.username ?? '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,32}$/.test(username)) throw new Error('Username: 2–32 letters, numbers, . _ -');
      if (String(body.password ?? '').length < 8) throw new Error('Password must be at least 8 characters');

      const { data: preset } = await admin.from('role_presets').select('permissions').eq('role', body.role).single();
      if (!preset) throw new Error('Unknown role');

      const { data: created, error } = await admin.auth.admin.createUser({
        email: `${username}@${LOGIN_EMAIL_DOMAIN}`,
        password: body.password,
        email_confirm: true, // no confirmation email is ever sent
      });
      if (error) throw error;

      const { error: profileError } = await admin.from('profiles').insert({
        id: created.user.id,
        username,
        full_name: body.full_name || username,
        role: body.role,
        department_id: body.department_id || null,
        phone: body.phone || null,
        contact_email: body.contact_email || null,
        permissions: preset.permissions,
        is_service_account: body.role === 'claude',
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id); // undo half-made account
        throw profileError;
      }
      await admin.from('activity_log').insert({ actor_id: callerId, action: 'user.created',
        target_type: 'user', target_id: created.user.id, summary: `Account created: ${body.full_name || username} (@${username}, ${body.role})` });
      return reply({ id: created.user.id });
    }

    if (body.action === 'reset_password') {
      if (String(body.password ?? '').length < 8) throw new Error('Password must be at least 8 characters');
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
      if (error) throw error;
      const { data: who } = await admin.from('profiles').select('full_name').eq('id', body.user_id).single();
      await admin.from('activity_log').insert({ actor_id: callerId, action: 'user.password_reset',
        target_type: 'user', target_id: body.user_id, summary: `Password reset for ${who?.full_name ?? 'user'}` });
      return reply({ ok: true });
    }

    if (body.action === 'set_active') {
      if (callerId === body.user_id) throw new Error("You can't deactivate yourself");
      // Banning blocks sign-in; the profile flag removes all permissions in RLS.
      const { error } = await admin.auth.admin.updateUserById(body.user_id, {
        ban_duration: body.active ? 'none' : '876000h', // ~100 years
      });
      if (error) throw error;
      // Done as the admin so the activity log records who did it
      await caller.from('profiles').update({ active: !!body.active }).eq('id', body.user_id);
      return reply({ ok: true });
    }

    return reply({ error: 'Unknown action' }, 400);
  } catch (e) {
    return reply({ error: (e as Error).message }, 400);
  }
});
