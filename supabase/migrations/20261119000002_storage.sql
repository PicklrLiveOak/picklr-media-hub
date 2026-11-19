-- =====================================================================
-- Storage: one private bucket "uploads" (images + PDFs, max 10 MB each)
-- Folder layout:
--   requests/<request_id>/<file>   -> same visibility as the request
--   avatars/<user_id>/<file>       -> anyone signed in can view; only you upload
-- (chat/<chat_id>/... is added in step 2)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/gif','image/heic','application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Turns 'requests/<uuid>/x.jpg' into the uuid, or null if it isn't one.
create or replace function public.path_uuid(path text, part int) returns uuid
language sql immutable as $$
  select case when split_part(path, '/', part) ~ '^[0-9a-f-]{36}$'
              then split_part(path, '/', part)::uuid end;
$$;

create policy "uploads: read" on storage.objects for select to authenticated using (
  bucket_id = 'uploads' and (
    (split_part(name, '/', 1) = 'requests' and public.can_view_request(public.path_uuid(name, 2)))
    or split_part(name, '/', 1) = 'avatars'
  )
);

create policy "uploads: add" on storage.objects for insert to authenticated with check (
  bucket_id = 'uploads' and (
    (split_part(name, '/', 1) = 'requests' and public.can_edit_request(public.path_uuid(name, 2)))
    or (split_part(name, '/', 1) = 'avatars' and public.path_uuid(name, 2) = auth.uid())
  )
);

create policy "uploads: remove" on storage.objects for delete to authenticated using (
  bucket_id = 'uploads' and (
    public.is_admin()
    or (split_part(name, '/', 1) = 'avatars' and public.path_uuid(name, 2) = auth.uid())
    or (split_part(name, '/', 1) = 'requests' and owner_id = auth.uid()::text
        and public.can_edit_request(public.path_uuid(name, 2)))
  )
);
