-- Targeted follow-up to 20261031074956. No existing content is rewritten.
begin;

create function public.activity_iso_time(value text) returns timestamptz
language plpgsql stable security invoker set search_path = pg_catalog, public
as $fn$
begin
  if value is null or value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return null; end if;
  return value::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or invalid_time_zone_displacement_value then return null;
end;
$fn$;

create function public.guard_activity_route_content() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public
as $fn$
declare
  previous jsonb := '{}'::jsonb;
  selected public.content_items%rowtype;
  old_route public.content_items%rowtype;
  route_id uuid;
  same_route boolean := false;
  dedup_rebind boolean := false;
  snap jsonb;
  key text;
  start_at timestamptz;
  end_at timestamptz;
  opens_at timestamptz;
  closes_at timestamptz;
  legacy_dates boolean := false;
  geometry jsonb;
  segments jsonb;
  segment jsonb;
  point jsonb;
  stats jsonb;
  legacy_source jsonb;
  native_location jsonb;
  legacy_restored boolean := false;
  legacy_usable boolean := false;
  location_label text;
begin
  -- Same table lock protocol as existing RPCs. Direct DML cannot race a save,
  -- delete or duplicate resolution to leave a dangling JSON association.
  lock table public.content_items in share row exclusive mode nowait;
  if tg_op = 'DELETE' then
    if old.kind = 'route' and (exists(select 1 from public.content_items c where c.kind='activity'
      and (c.payload->>'routeId'=old.id::text or c.id::text=old.payload->>'generatedFromActivityId'))
      or exists(select 1 from public.content_items c where c.id<>old.id and c.payload->>'duplicateWinnerId'=old.id::text)) then
      raise exception using errcode='22023',message='CONTENT_IN_USE';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.kind is distinct from old.kind then
      raise exception using errcode='22023',message='CONTENT_ID_KIND_IMMUTABLE';
    end if;
    previous := old.payload;
  end if;
  if new.kind <> 'activity' then return new; end if;
  foreach key in array array['track','trackLocalId','trackSummary'] loop
    if (new.payload ? key) is distinct from (previous ? key) or new.payload->key is distinct from previous->key then
      raise exception using errcode='22023',message='ACTIVITY_OWN_TRACK_IMMUTABLE';
    end if;
  end loop;
  if tg_op='UPDATE' then
    same_route := nullif(new.payload->>'routeId','') is not distinct from nullif(previous->>'routeId','');
  end if;
  if nullif(new.payload->>'routeId','') is not null then
    begin route_id := (new.payload->>'routeId')::uuid;
    exception when invalid_text_representation then raise exception using errcode='22023',message='INVALID_ROUTE'; end;
    select * into selected from public.content_items where id=route_id and kind='route';
    if not found or selected.payload->>'archived'='true' or selected.payload->>'isDemo'='true' then
      raise exception using errcode='22023',message='ROUTE_UNAVAILABLE';
    end if;
    if not same_route and previous->>'routeId' is not null then
      select * into old_route from public.content_items where id::text=previous->>'routeId' and kind='route';
      -- Existing audited dedup RPC changes association only. History belongs to
      -- the originally selected route even after its top-level redirect changes.
      dedup_rebind := old_route.payload->>'archived'='true'
        and old_route.payload->>'archivedReason'='duplicate'
        and old_route.payload->>'duplicateWinnerId'=route_id::text
        and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(selected.payload->'duplicateResolutions')='array'
          then selected.payload->'duplicateResolutions' else '[]'::jsonb end) a
          where a->>'winnerId'=route_id::text and a->'originalIds' ? old_route.id::text);
    end if;
    if same_route or coalesce(dedup_rebind,false) then
      if new.payload->'routeSnapshot' is distinct from previous->'routeSnapshot' then
        raise exception using errcode='22023',message='ACTIVITY_SNAPSHOT_IMMUTABLE';
      end if;
      snap := previous->'routeSnapshot';
    else
      if new.payload ? 'routeSnapshot' then raise exception using errcode='22023',message='ACTIVITY_SNAPSHOT_SERVER_ONLY'; end if;
      if jsonb_typeof(selected.payload->'track') is distinct from 'object' then
        raise exception using errcode='22023',message='ROUTE_TRACK_UNAVAILABLE';
      end if;
      stats := selected.payload#>'{track,stats}';
      if jsonb_typeof(stats->'distanceM') is distinct from 'number'
        or (stats ? 'ascentM' and jsonb_typeof(stats->'ascentM') not in ('number','null')) then
        raise exception using errcode='22023',message='INVALID_ROUTE_TRACK';
      end if;
      if (stats->>'distanceM')::numeric<0 or (stats->>'ascentM')::numeric<0 then
        raise exception using errcode='22023',message='INVALID_ROUTE_TRACK';
      end if;
      geometry := selected.payload#>'{track,geojson,geometry}';
      segments := case geometry->>'type' when 'LineString' then jsonb_build_array(geometry->'coordinates')
        when 'MultiLineString' then geometry->'coordinates' else null end;
      if jsonb_typeof(segments) is distinct from 'array' or segments='[]'::jsonb then
        raise exception using errcode='22023',message='INVALID_ROUTE_TRACK';
      end if;
      for segment in select jsonb_array_elements(segments) loop
        if jsonb_typeof(segment) is distinct from 'array' then raise exception using errcode='22023',message='INVALID_ROUTE_TRACK'; end if;
        if jsonb_array_length(segment)<2 then raise exception using errcode='22023',message='INVALID_ROUTE_TRACK'; end if;
        for point in select jsonb_array_elements(segment) loop
          if jsonb_typeof(point) is distinct from 'array' then raise exception using errcode='22023',message='INVALID_ROUTE_TRACK'; end if;
          if jsonb_array_length(point)<2 or jsonb_typeof(point->0) is distinct from 'number' or jsonb_typeof(point->1) is distinct from 'number' then
            raise exception using errcode='22023',message='INVALID_ROUTE_TRACK';
          end if;
          if abs((point->>0)::numeric)>180 or abs((point->>1)::numeric)>90 then raise exception using errcode='22023',message='INVALID_ROUTE_TRACK'; end if;
        end loop;
      end loop;
      snap := jsonb_build_object('sourceRouteId',route_id::text,'selectedAt',transaction_timestamp());
      foreach key in array array['title','track','trackSummary','distance','ascent','coordinates','location','province','city','provinceCode','cityCode','locations','locationStatus'] loop
        if selected.payload ? key then snap := jsonb_set(snap,array[key],selected.payload->key); end if;
      end loop;
      snap := snap || jsonb_build_object('distance',(stats->>'distanceM')::numeric/1000,'ascent',(stats->>'ascentM')::numeric);
      point := selected.payload->'coordinates';
      if not (case when jsonb_typeof(point)='array' then jsonb_array_length(point)>=2
        and jsonb_typeof(point->0)='number' and jsonb_typeof(point->1)='number' else false end) then point := segments#>'{0,0}'; end if;
      if abs((point->>0)::numeric)>180 or abs((point->>1)::numeric)>90 then point := segments#>'{0,0}'; end if;
      snap := jsonb_set(snap,'{coordinates}',jsonb_build_array(point->0,point->1));
      new.payload := jsonb_set(new.payload,'{routeSnapshot}',snap);
    end if;
  else
    if new.payload ? 'routeSnapshot' then raise exception using errcode='22023',message='ACTIVITY_SNAPSHOT_WITHOUT_ROUTE'; end if;
    new.payload := new.payload - array['routeId','routeLinkSource'];
  end if;
  if snap is not null then
    foreach key in array array['distance','ascent','coordinates','location','province','city','provinceCode','cityCode','locations','locationStatus'] loop
      if snap ? key then new.payload := jsonb_set(new.payload,array[key],snap->key);
      else new.payload := new.payload-key; end if;
    end loop;
    new.payload := new.payload || jsonb_build_object('routeLinkSource','route-selection');
  elsif previous ? 'routeSnapshot' and nullif(new.payload->>'routeId','') is null
    and (previous ? 'track' or previous ? 'trackLocalId' or previous ? 'trackSummary') then
    -- Clearing a selection restores the immutable activity-owned track. Its
    -- top-level metrics/location may already describe the discarded snapshot,
    -- so derive only from the original track/summary, never those top-levels.
    legacy_restored := true;
    new.payload := new.payload-array['distance','ascent','coordinates','location','province','city','provinceCode','cityCode','adcode','locations','locationStatus'];
    legacy_source := case when jsonb_typeof(previous->'track')='object' then previous->'track' else previous->'trackSummary' end;
    stats := case when jsonb_typeof(legacy_source->'stats')='object' then legacy_source->'stats'
      when jsonb_typeof(previous#>'{trackSummary,stats}')='object' then previous#>'{trackSummary,stats}' else legacy_source end;
    native_location := case when jsonb_typeof(legacy_source->'location')='object' then legacy_source->'location'
      when jsonb_typeof(previous#>'{trackSummary,location}')='object' then previous#>'{trackSummary,location}' else '{}'::jsonb end;
    if jsonb_typeof(stats->'distanceM')='number' then
      if (stats->>'distanceM')::numeric>=0 then
        new.payload := jsonb_set(new.payload,'{distance}',to_jsonb((stats->>'distanceM')::numeric/1000));
        legacy_usable := true;
      end if;
    end if;
    new.payload := jsonb_set(new.payload,'{ascent}',case when jsonb_typeof(stats->'ascentM')='number' then
      case when (stats->>'ascentM')::numeric>=0 then stats->'ascentM' else 'null'::jsonb end else 'null'::jsonb end);
    geometry := legacy_source#>'{geojson,geometry}';
    foreach point in array array[native_location->'coordinates',legacy_source->'coordinates',previous#>'{trackSummary,coordinates}',
      case geometry->>'type' when 'MultiLineString' then geometry#>'{coordinates,0,0}' when 'LineString' then geometry#>'{coordinates,0}' else null end] loop
      if (case when jsonb_typeof(point)='array' then jsonb_array_length(point)>=2
        and jsonb_typeof(point->0)='number' and jsonb_typeof(point->1)='number' else false end) then
        if abs((point->>0)::numeric)<=180 and abs((point->>1)::numeric)<=90 then
          new.payload := jsonb_set(new.payload,'{coordinates}',jsonb_build_array(point->0,point->1));
          exit;
        end if;
      end if;
    end loop;
    legacy_usable := legacy_usable and (new.payload ? 'coordinates')
      and (coalesce(geometry->>'type' in ('LineString','MultiLineString'),false) or previous ? 'trackLocalId');
    foreach key in array array['province','city','provinceCode','cityCode','adcode','locations','locationStatus'] loop
      if native_location ? key and native_location->key<>'null'::jsonb then
        new.payload := jsonb_set(new.payload,array[key],native_location->key);
      end if;
    end loop;
    select string_agg(place,' / ' order by first_seen) into location_label from (
      select coalesce(nullif(p->>'city',''),nullif(p->>'province','')) as place,min(ord) as first_seen
      from jsonb_array_elements(case when jsonb_typeof(native_location->'locations')='array' then native_location->'locations' else '[]'::jsonb end)
      with ordinality as places(p,ord) group by 1) labels where place is not null;
    if location_label is null then
      select string_agg(place,' · ' order by first_seen) into location_label from (
        select place,min(ord) as first_seen from (values (1,nullif(native_location->>'province','')),
          (2,nullif(native_location->>'city',''))) labels(ord,place) where place is not null group by place) places;
    end if;
    if location_label is not null then new.payload := jsonb_set(new.payload,'{location}',to_jsonb(location_label)); end if;
  elsif not (previous ? 'track' or previous ? 'trackLocalId' or previous ? 'trackSummary') then
    new.payload := (new.payload-array['distance','ascent','coordinates','location','province','city','provinceCode','cityCode','locations','locationStatus'])
      || jsonb_build_object('footprintEligible',false,'includeFootprint',false);
  end if;
  -- Legacy dates are left opaque only for an already published, unchanged old
  -- schedule without either new field. Opening registration always opts in.
  legacy_dates := tg_op='UPDATE' and (old.published or not new.published)
    and not (previous ? 'dateEnd') and not (previous ? 'registrationStart')
    and not (new.payload ? 'dateEnd') and not (new.payload ? 'registrationStart')
    and new.payload->'dateStart' is not distinct from previous->'dateStart'
    and new.payload->'registrationDeadline' is not distinct from previous->'registrationDeadline'
    and (new.payload->>'registrationOpen' is distinct from 'true'
      or new.payload->'registrationOpen' is not distinct from previous->'registrationOpen');
  start_at := public.activity_iso_time(new.payload->>'dateStart');
  end_at := public.activity_iso_time(new.payload->>'dateEnd');
  opens_at := public.activity_iso_time(new.payload->>'registrationStart');
  closes_at := public.activity_iso_time(new.payload->>'registrationDeadline');
  if not legacy_dates then
    foreach key in array array['dateStart','dateEnd','registrationStart','registrationDeadline'] loop
      if new.payload->key is not null and new.payload->key <> 'null'::jsonb
        and public.activity_iso_time(new.payload->>key) is null then
        raise exception using errcode='22023',message='INVALID_ACTIVITY_SCHEDULE';
      end if;
    end loop;
    if (new.published and (start_at is null or end_at is null))
      or (start_at is not null and end_at is not null and start_at>=end_at)
      or (opens_at is not null and closes_at is not null and opens_at>=closes_at)
      or (closes_at is not null and start_at is not null and closes_at>start_at)
      or (new.payload->>'registrationOpen'='true' and (opens_at is null or closes_at is null or start_at is null or end_at is null)) then
      raise exception using errcode='22023',message='INVALID_ACTIVITY_SCHEDULE';
    end if;
  end if;
  if snap is not null or legacy_restored then
    new.payload := new.payload || jsonb_build_object('organizer','chuanheng',
      'footprintEligible',(snap is not null or legacy_usable) and new.payload->>'archived' is distinct from 'true',
      'includeFootprint',(snap is not null or legacy_usable) and new.payload->>'archived' is distinct from 'true' and start_at is not null);
  end if;
  return new;
end;
$fn$;
create trigger guard_activity_route_content before insert or update or delete on public.content_items
for each row execute function public.guard_activity_route_content();

-- Deferred because the existing duplicate transaction first archives losers and
-- only then redirects activities. Integrity is checked at transaction end.
create function public.check_activity_route_references() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public
as $fn$
begin
  if exists(select 1 from public.content_items a left join public.content_items r
    on r.id::text=a.payload->>'routeId' and r.kind='route'
    where a.kind='activity' and nullif(a.payload->>'routeId','') is not null
    and (a.id=case when tg_op='DELETE' then old.id else new.id end
      or a.payload->>'routeId'=case when tg_op='DELETE' then old.id::text else new.id::text end)
    and (r.id is null or r.payload->>'archived'='true' or r.payload->>'isDemo'='true')) then
    raise exception using errcode='22023',message='ROUTE_REFERENCE_UNAVAILABLE';
  end if;
  return null;
end;
$fn$;
create constraint trigger check_activity_route_references after insert or update or delete on public.content_items
deferrable initially deferred for each row execute function public.check_activity_route_references();

create function public.save_activity_with_route(activity_record jsonb) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout='5s'
as $fn$
declare
  target_id uuid;
  existing public.content_items%rowtype;
  selected public.content_items%rowtype;
  saved public.content_items%rowtype;
  body jsonb;
  is_existing boolean;
  publication boolean;
  created timestamptz;
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
    raise exception using errcode='42501',message='Only verified administrators may save activities.';
  end if;
  if jsonb_typeof(activity_record) is distinct from 'object' or activity_record->>'kind' is distinct from 'activity'
    or jsonb_typeof(activity_record->'payload') is distinct from 'object'
    or jsonb_typeof(activity_record#>'{payload,title}') is distinct from 'string'
    or public.route_title_key(activity_record#>>'{payload,title}')='' then
    raise exception using errcode='22023',message='INVALID_ACTIVITY';
  end if;
  begin target_id := (activity_record->>'id')::uuid;
  exception when invalid_text_representation then raise exception using errcode='22023',message='INVALID_ACTIVITY_ID'; end;
  if target_id is null or jsonb_typeof(activity_record->'published') is distinct from 'boolean' then
    raise exception using errcode='22023',message='INVALID_ACTIVITY';
  end if;
  publication := (activity_record->>'published')::boolean;
  body := (activity_record->'payload')-'routeSnapshot';
  body := body || jsonb_build_object('isDemo',false);
  lock table public.content_items in share row exclusive mode nowait;
  select * into existing from public.content_items where id=target_id for update;
  is_existing := found;
  if is_existing then
    if existing.kind<>'activity' then raise exception using errcode='22023',message='ID_CONFLICT'; end if;
    if jsonb_typeof(activity_record->'expected') is distinct from 'object'
      or not ((activity_record->'expected') ?& array['payload','published']) then
      raise exception using errcode='22023',message='EXPECTED_ACTIVITY_REQUIRED';
    end if;
    if activity_record#>'{expected,payload}' is distinct from existing.payload
      or activity_record#>'{expected,published}' is distinct from to_jsonb(existing.published) then
      raise exception using errcode='22023',message='STALE_ACTIVITY';
    end if;
    created := existing.created_at;
    if nullif(body->>'routeId','') is not distinct from nullif(existing.payload->>'routeId','') and existing.payload ? 'routeSnapshot' then
      body := jsonb_set(body,'{routeSnapshot}',existing.payload->'routeSnapshot');
    end if;
  else
    if activity_record->'expected' is not null and activity_record->'expected'<>'null'::jsonb then
      raise exception using errcode='22023',message='STALE_ACTIVITY';
    end if;
    created := coalesce(public.activity_iso_time(activity_record->>'created_at'),transaction_timestamp());
    if activity_record ? 'created_at' and public.activity_iso_time(activity_record->>'created_at') is null then
      raise exception using errcode='22023',message='INVALID_ACTIVITY_DATE';
    end if;
  end if;
  if nullif(body->>'routeId','') is not null then
    select * into selected from public.content_items where id::text=body->>'routeId' and kind='route';
    if not found or selected.payload->>'archived'='true' or selected.payload->>'isDemo'='true' then
      raise exception using errcode='22023',message='ROUTE_UNAVAILABLE';
    end if;
    if not is_existing or body->>'routeId' is distinct from existing.payload->>'routeId' then
      if not (activity_record ? 'routeExpectedPayload') then raise exception using errcode='22023',message='EXPECTED_ROUTE_REQUIRED'; end if;
      if activity_record->'routeExpectedPayload' is distinct from selected.payload then raise exception using errcode='22023',message='STALE_ROUTE'; end if;
    end if;
  end if;
  if is_existing then
    update public.content_items set payload=body,published=publication where id=target_id returning * into saved;
  else
    insert into public.content_items(id,kind,payload,published,created_at) values(target_id,'activity',body,publication,created) returning * into saved;
  end if;
  if not found then raise exception using errcode='42501',message='ACTIVITY_WRITE_DENIED'; end if;
  return jsonb_build_object('activity',to_jsonb(saved),'route',case when selected.id is not null then to_jsonb(selected) else 'null'::jsonb end);
end;
$fn$;

create or replace function public.delete_content_with_links(content_id uuid) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public set lock_timeout='5s'
as $fn$
declare target public.content_items%rowtype;
begin
  if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
    raise exception using errcode='42501',message='Only verified administrators may delete linked content.';
  end if;
  lock table public.content_items in share row exclusive mode nowait;
  select * into target from public.content_items where id=content_id for update;
  if not found then raise exception using errcode='22023',message='CONTENT_NOT_FOUND'; end if;
  -- Route trigger protects references. Delete activity first, so FK restrictions
  -- abort before any cleanup; no old track-writing RPC is needed.
  delete from public.content_items where id=content_id;
  if not found then raise exception using errcode='42501',message='CONTENT_DELETE_DENIED'; end if;
  if target.kind='activity' then
    update public.content_items r set published=false,payload=r.payload || jsonb_build_object(
      'archived',true,'archivedReason','activity-track-removed','archivedAt',transaction_timestamp())
    where r.kind='route' and r.payload->>'generatedFromActivityId'=content_id::text
      and r.payload->>'archived' is distinct from 'true'
      and not (case when jsonb_typeof(r.payload->'duplicateResolutions')='array' then jsonb_array_length(r.payload->'duplicateResolutions')>0 else false end)
      and not exists(select 1 from public.content_items a where a.kind='activity' and a.payload->>'routeId'=r.id::text)
      and not exists(select 1 from public.content_items d where d.payload->>'duplicateWinnerId'=r.id::text);
  end if;
  return jsonb_build_object('deletedId',content_id);
end;
$fn$;

drop policy applications_owner_insert on public.applications;
create policy applications_owner_insert on public.applications for insert to authenticated
with check ((select auth.uid())=user_id and exists(
  select 1 from public.content_items c where c.id=activity_id and c.kind='activity' and c.published
    and coalesce(c.payload->>'isDemo','false')<>'true' and coalesce(c.payload->>'archived','false')<>'true'
    and c.payload->>'registrationOpen'='true' and coalesce(c.payload->>'status','')<>'已结束'
    and public.activity_iso_time(c.payload->>'registrationStart')<=now()
    and now()<public.activity_iso_time(c.payload->>'registrationDeadline')
    and now()<public.activity_iso_time(c.payload->>'dateStart')
    and now()<public.activity_iso_time(c.payload->>'dateEnd')
    and public.activity_iso_time(c.payload->>'registrationStart')<public.activity_iso_time(c.payload->>'registrationDeadline')
    and public.activity_iso_time(c.payload->>'registrationDeadline')<=public.activity_iso_time(c.payload->>'dateStart')
    and public.activity_iso_time(c.payload->>'dateStart')<public.activity_iso_time(c.payload->>'dateEnd')
));

revoke all on function public.activity_iso_time(text) from public,anon,authenticated;
revoke all on function public.guard_activity_route_content() from public,anon,authenticated;
revoke all on function public.check_activity_route_references() from public,anon,authenticated;
revoke all on function public.save_activity_with_route(jsonb) from public,anon,authenticated;
revoke all on function public.save_activity_with_track(jsonb) from public,anon,authenticated;
grant execute on function public.activity_iso_time(text) to authenticated;
grant execute on function public.save_activity_with_route(jsonb) to authenticated;

-- Public image delivery is handled by Storage's public bucket endpoint. Object
-- listing/upload metadata remains restricted to the administrator's UUID folder.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('activity-covers','activity-covers',true,5242880,array['image/jpeg','image/png','image/webp']);
create policy activity_covers_admin_insert on storage.objects for insert to authenticated
with check(bucket_id='activity-covers' and (select auth.uid()) is not null
  and (select auth.jwt())->'app_metadata'->>'role'='admin'
  and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy activity_covers_admin_read_own on storage.objects for select to authenticated
using(bucket_id='activity-covers' and (select auth.uid()) is not null
  and (select auth.jwt())->'app_metadata'->>'role'='admin'
  and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Existing Storage policies combine with OR. Restrictive bucket-scoped guards
-- prevent an older broad policy from reopening upload, overwrite or deletion.
create policy activity_covers_guard_insert on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'activity-covers' or ((select auth.uid()) is not null
  and (select auth.jwt())->'app_metadata'->>'role'='admin'
  and (storage.foldername(name))[1]=(select auth.uid())::text));
create policy activity_covers_guard_select on storage.objects as restrictive for select to anon,authenticated
using(bucket_id<>'activity-covers' or ((select auth.uid()) is not null
  and (select auth.jwt())->'app_metadata'->>'role'='admin'
  and (storage.foldername(name))[1]=(select auth.uid())::text));
create policy activity_covers_guard_update on storage.objects as restrictive for update to anon,authenticated
using(bucket_id<>'activity-covers') with check(bucket_id<>'activity-covers');
create policy activity_covers_guard_delete on storage.objects as restrictive for delete to anon,authenticated
using(bucket_id<>'activity-covers');
commit;
