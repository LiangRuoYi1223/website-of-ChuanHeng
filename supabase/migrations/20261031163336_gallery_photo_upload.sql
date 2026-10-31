begin;

-- Separate immutable gallery uploads from activity covers and legacy storage.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('gallery-photos','gallery-photos',true,3145728,array['image/webp']);

create policy gallery_photos_admin_insert on storage.objects for insert to authenticated
with check(bucket_id='gallery-photos' and (select auth.uid()) is not null
  and (select auth.jwt())->'app_metadata'->>'role'='admin'
  and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy gallery_photos_admin_read_own on storage.objects for select to authenticated
using(bucket_id='gallery-photos' and (select auth.uid()) is not null
  and (select auth.jwt())->'app_metadata'->>'role'='admin'
  and (storage.foldername(name))[1]=(select auth.uid())::text);

-- Restrictive guards keep unrelated permissive policies from granting access.
create policy gallery_photos_guard_insert on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'gallery-photos' or ((select auth.uid()) is not null
  and (select auth.jwt())->'app_metadata'->>'role'='admin'
  and (storage.foldername(name))[1]=(select auth.uid())::text));
create policy gallery_photos_guard_select on storage.objects as restrictive for select to anon,authenticated
using(bucket_id<>'gallery-photos' or ((select auth.uid()) is not null
  and (select auth.jwt())->'app_metadata'->>'role'='admin'
  and (storage.foldername(name))[1]=(select auth.uid())::text));
create policy gallery_photos_guard_update on storage.objects as restrictive for update to anon,authenticated
using(bucket_id<>'gallery-photos') with check(bucket_id<>'gallery-photos');
create policy gallery_photos_guard_delete on storage.objects as restrictive for delete to anon,authenticated
using(bucket_id<>'gallery-photos');

commit;
