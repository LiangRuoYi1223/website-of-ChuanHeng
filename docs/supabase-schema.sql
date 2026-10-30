-- REVIEW DRAFT FOR A NEW PROJECT. Not executed against any cloud database.
-- Review the deployment guide and project grants before running this transaction.
-- Intentionally fails if these tables already exist; never overwrite a live schema.
begin;

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('activity', 'route', 'photo', 'article')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create index content_items_kind_published_created_idx
  on public.content_items (kind, published, created_at desc);

alter table public.content_items enable row level security;
alter table public.content_items force row level security;

revoke all on public.content_items from public, anon, authenticated;
grant select on public.content_items to anon, authenticated;
grant insert, update, delete on public.content_items to authenticated;

create policy content_public_read on public.content_items
  for select to anon, authenticated
  using (published and coalesce(payload ->> 'isDemo', 'false') <> 'true');

-- app_metadata is set only by a trusted server/admin, never by public signUp data.
create policy content_admin_read on public.content_items
  for select to authenticated
  using ((select auth.uid()) is not null
    and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

create policy content_admin_insert on public.content_items
  for insert to authenticated
  with check ((select auth.uid()) is not null
    and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

create policy content_admin_update on public.content_items
  for update to authenticated
  using ((select auth.uid()) is not null
    and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin')
  with check ((select auth.uid()) is not null
    and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

create policy content_admin_delete on public.content_items
  for delete to authenticated
  using ((select auth.uid()) is not null
    and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.content_items(id) on delete restrict,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (activity_id, user_id)
);

create index applications_user_created_idx on public.applications (user_id, created_at desc);
alter table public.applications enable row level security;
alter table public.applications force row level security;

revoke all on public.applications from public, anon, authenticated;
grant select, insert on public.applications to authenticated;

create policy applications_owner_insert on public.applications
  for insert to authenticated
  with check ((select auth.uid()) = user_id
    and exists (
      select 1 from public.content_items c
      where c.id = activity_id and c.kind = 'activity' and c.published
        and coalesce(c.payload ->> 'isDemo', 'false') <> 'true'
        and c.payload ->> 'registrationOpen' = 'true'
        and coalesce(c.payload ->> 'status', '') <> '已结束'
        and (c.payload ->> 'registrationDeadline')::timestamptz > now()
    ));

create policy applications_owner_read on public.applications
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy applications_admin_read on public.applications
  for select to authenticated
  using ((select auth.uid()) is not null
    and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

comment on table public.content_items is 'Association content. Only published non-demo records are public.';
comment on table public.applications is 'Private applications. No anonymous access or frontend update/delete grants.';
commit;
