-- Picklr Media Hub — Claude assistant (MCP connector)
--
-- People with the "claude.connect" permission can add Media Hub as a connector
-- in their Claude app. Claude then acts AS THAT PERSON (same permissions), and
-- anything it sends is tagged "via Claude". The admin can also ask Claude to
-- act as the separate Claude service account (role 'claude').
-- Every tool call is written to the activity log with source = 'mcp'.

-- Chat messages Claude sends for someone show a small "via Claude" tag
alter table public.messages add column via text check (via in ('claude'));

-- Only the admin has it by default; tick it per person in Admin → People
-- (admins already pass every has_perm check).
