begin;
-- Additive site artwork configuration. No content, applications, historical
-- objects or legacy chuanheng records are changed by this migration.
-- Applied via the trusted Supabase migration API; timestamp matches its history.
-- Validated in isolated Postgres before application to the production project.

create table public.site_image_settings (
 singleton boolean primary key default true check(singleton),
 config jsonb not null default '{}'::jsonb check(jsonb_typeof(config)='object'),
 updated_at timestamptz
);
insert into public.site_image_settings(singleton) values(true);
alter table public.site_image_settings enable row level security;
alter table public.site_image_settings force row level security;
revoke all on public.site_image_settings from public,anon,authenticated;
grant select on public.site_image_settings to anon,authenticated;
create policy site_image_settings_public_read on public.site_image_settings
 for select to anon,authenticated using(singleton);

create table private.site_image_settings_events (
 id bigint generated always as identity primary key,
 actor_id uuid not null,
 before_config jsonb not null,
 after_config jsonb not null,
 occurred_at timestamptz not null default clock_timestamp()
);
alter table private.site_image_settings_events enable row level security;
alter table private.site_image_settings_events force row level security;
revoke all on private.site_image_settings_events from public,anon,authenticated;
revoke all on sequence private.site_image_settings_events_id_seq from public,anon,authenticated;

create function private.valid_site_image_entry(entry jsonb,slide boolean)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog
as $fn$
declare image_url text;
begin
 if jsonb_typeof(entry) is distinct from 'object'
  or not(entry ?& array['url','alt','credit'])
  or jsonb_typeof(entry->'url') is distinct from 'string'
  or jsonb_typeof(entry->'alt') is distinct from 'string'
  or jsonb_typeof(entry->'credit') is distinct from 'string'
  or length(entry->>'alt')>200 or length(entry->>'credit')>200 then return false; end if;
 if slide then
  if jsonb_typeof(entry->'id') is distinct from 'string'
   or (entry->>'id') !~ '^[A-Za-z0-9_-]{1,80}$'
   or entry-array['id','url','alt','credit']<>'{}'::jsonb then return false; end if;
 elsif entry-array['url','alt','credit']<>'{}'::jsonb then return false;
 end if;
 image_url:=entry->>'url';
 if length(image_url)<2 or length(image_url)>2048
  or image_url ~ '[[:space:][:cntrl:]]' or strpos(image_url,chr(92))>0 then return false; end if;
 return (left(image_url,1)='/' and left(image_url,2)<>'//')
  or image_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?([/?#].*)?$';
end;$fn$;

create function private.valid_site_images(p_config jsonb)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog
as $fn$
declare entry jsonb; slot text;
 valid_slots constant text[]:=array['activitiesHero','routesHero','galleryHero','newsHero','aboutHero','footprintsHero','joinHero','loginBackground','homeAbout','homeKnowledge','homeJoin','aboutStory','joinStory','joinClosing','routeFallback','photoFallback','articleFallback','activityFallback'];
begin
 if p_config is null or jsonb_typeof(p_config) is distinct from 'object'
  or octet_length(p_config::text)>131072
  or not(p_config ?& array['heroSlides','slots'])
  or p_config-array['heroSlides','slots']<>'{}'::jsonb
  or jsonb_typeof(p_config->'heroSlides') is distinct from 'array'
  or jsonb_typeof(p_config->'slots') is distinct from 'object' then return false; end if;
 if jsonb_array_length(p_config->'heroSlides')<1 then return false; end if;
 for entry in select value from jsonb_array_elements(p_config->'heroSlides') loop
  if not private.valid_site_image_entry(entry,true) then return false; end if;
 end loop;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_config->'heroSlides')) then return false; end if;
 for slot,entry in select key,value from jsonb_each(p_config->'slots') loop
  if not(slot=any(valid_slots)) or not private.valid_site_image_entry(entry,false) then return false; end if;
 end loop;
 return true;
end;$fn$;

create function public.get_site_images()
returns jsonb language sql stable security invoker set search_path=pg_catalog,public
as $fn$
 select jsonb_build_object('config',config,'updatedAt',updated_at)
 from public.site_image_settings where singleton;
$fn$;

-- A private definer is necessary because the browser receives no direct DML
-- grants. Its public wrapper is an invoker and the identity is checked again
-- at this privilege boundary. No arbitrary subject, table or object is accepted.
create function private.save_site_images(p_config jsonb,p_expected_updated_at timestamptz,p_expected_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
set row_security=off set lock_timeout='5s'
as $fn$
declare settings public.site_image_settings%rowtype; changed_at timestamptz;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then
  raise exception using errcode='42501',message='AUTH_REQUIRED';
 end if;
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
  raise exception using errcode='42501',message='ADMIN_REQUIRED';
 end if;
 if p_expected_user_id is null or p_expected_user_id is distinct from auth.uid() then
  raise exception using errcode='42501',message='AUTH_CHANGED';
 end if;
 if not private.valid_site_images(p_config) then
  raise exception using errcode='22023',message='INVALID_SITE_IMAGES';
 end if;
 select * into settings from public.site_image_settings where singleton for update;
 if not found then raise exception 'SITE_IMAGES_UNAVAILABLE'; end if;
 if settings.updated_at is distinct from p_expected_updated_at then
  raise exception using errcode='40001',message='STALE_SITE_IMAGES';
 end if;
 if settings.config is not distinct from p_config then return public.get_site_images(); end if;
 changed_at:=greatest(clock_timestamp(),coalesce(settings.updated_at+interval '1 microsecond',clock_timestamp()));
 update public.site_image_settings set config=p_config,updated_at=changed_at where singleton;
 insert into private.site_image_settings_events(actor_id,before_config,after_config,occurred_at)
 values(auth.uid(),settings.config,p_config,changed_at);
 return public.get_site_images();
end;$fn$;

create function public.save_site_images(p_config jsonb,p_expected_updated_at timestamptz,p_expected_user_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog,public
as $fn$ select private.save_site_images(p_config,p_expected_updated_at,p_expected_user_id); $fn$;

revoke all on function private.valid_site_image_entry(jsonb,boolean),private.valid_site_images(jsonb),
 private.save_site_images(jsonb,timestamptz,uuid),public.get_site_images(),
 public.save_site_images(jsonb,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.get_site_images() to anon,authenticated;
grant execute on function private.save_site_images(jsonb,timestamptz,uuid),public.save_site_images(jsonb,timestamptz,uuid) to authenticated;

comment on table public.site_image_settings is 'Public site artwork only. Singleton; writes exclusively through administrator CAS RPC.';
comment on table private.site_image_settings_events is 'Append-only site artwork changes. No website role access; trusted database maintenance only.';
commit;
