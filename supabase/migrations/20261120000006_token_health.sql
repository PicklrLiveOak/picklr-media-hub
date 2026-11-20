-- Token health: the sync function asks Meta (debug_token) whether the stored
-- token still works, and records the answer here for the Insights + Admin pages.
alter table public.social_accounts
  add column token_status     text not null default 'unknown'
                               check (token_status in ('ok', 'warning', 'invalid', 'unknown')),
  add column token_message    text,          -- e.g. "Never expires" / Meta's error text
  add column token_checked_at timestamptz,
  add column token_expires_at timestamptz;   -- null = no expiry date
