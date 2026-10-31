-- Applied in production migration 20261031074956.
-- Readable source only; do not repeat CREATE on the migrated project.
-- Targets the NEW public.content_items JSON model only. No table DDL or old
-- chuanheng schema changes. The documented isolated matrix has passed; production
-- objects now exist. Future changes require a new targeted migration. CREATE
-- intentionally fails for an existing signature; do not replace blindly.
begin;

create function public.route_title_key(value text)
returns text
language sql immutable security invoker
set search_path = pg_catalog, public
as $function$
  -- Explicit ECMAScript whitespace set, including BOM. NFKC precedes folding.
  select lower(btrim(regexp_replace(normalize(coalesce(value, ''), NFKC),
    U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')));
$function$;

create function public.resolve_route_duplicates(route_ids uuid[], keep_id uuid)
returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public
set lock_timeout = '5s'
as $function$
declare
  actor uuid := auth.uid();
  expected uuid[];
  actual uuid[];
  losers uuid[];
  route_key text;
  winning public.content_items%rowtype;
  at_time timestamptz := transaction_timestamp();
  audit jsonb;
begin
  if actor is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception using errcode = '42501', message = 'Only verified administrators may resolve duplicate routes.';
  end if;
  if route_ids is null or cardinality(route_ids) < 2 or keep_id is null
     or array_position(route_ids, null) is not null or not (keep_id = any(route_ids)) then
    raise exception using errcode = '22023', message = 'INVALID_DUPLICATE_SELECTION';
  end if;
  select array_agg(distinct id order by id) into expected from unnest(route_ids) as ids(id);
  if cardinality(expected) <> cardinality(route_ids) then
    raise exception using errcode = '22023', message = 'INVALID_DUPLICATE_SELECTION';
  end if;

  -- Row locks alone do not protect against a new same-title INSERT. Serialize
  -- content writers for this short transaction before reading the complete group.
  -- NOWAIT fails safely under contention instead of holding an API request open.
  lock table public.content_items in share row exclusive mode nowait;
  select * into winning from public.content_items where id = keep_id and kind = 'route' for update;
  if not found or winning.payload -> 'archived' = 'true'::jsonb
     or jsonb_typeof(winning.payload -> 'title') is distinct from 'string' then
    raise exception using errcode = '22023', message = 'STALE_DUPLICATE_GROUP';
  end if;
  route_key := public.route_title_key(winning.payload ->> 'title');
  if route_key = '' then raise exception using errcode = '22023', message = 'STALE_DUPLICATE_GROUP'; end if;
  perform id from public.content_items
    where kind = 'route' and payload -> 'archived' is distinct from 'true'::jsonb
      and jsonb_typeof(payload -> 'title') = 'string'
      and public.route_title_key(payload ->> 'title') = route_key
    order by id for update;
  select array_agg(id order by id) into actual from public.content_items
    where kind = 'route' and payload -> 'archived' is distinct from 'true'::jsonb
      and jsonb_typeof(payload -> 'title') = 'string'
      and public.route_title_key(payload ->> 'title') = route_key;
  if actual is distinct from expected then
    raise exception using errcode = '22023', message = 'STALE_DUPLICATE_GROUP';
  end if;
  if winning.payload ? 'duplicateResolutions'
     and jsonb_typeof(winning.payload -> 'duplicateResolutions') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'INVALID_AUDIT';
  end if;
  select array_agg(id order by id) into losers from unnest(expected) as ids(id) where id <> keep_id;
  audit := jsonb_build_object('originalIds', to_jsonb(expected), 'winnerId', keep_id,
    'actorId', actor, 'at', at_time);

  update public.content_items set payload = jsonb_set(payload, '{duplicateResolutions}',
    coalesce(payload -> 'duplicateResolutions', '[]'::jsonb) || jsonb_build_array(audit))
    where id = keep_id;
  update public.content_items set published = false, payload = payload || jsonb_build_object(
    'archived', true, 'archivedReason', 'duplicate', 'archivedAt', at_time,
    'archivedBy', actor, 'duplicateWinnerId', keep_id)
    where id = any(losers) and kind = 'route';
  -- Only the association changes. Activity-owned tracks and all losing-route
  -- geometry remain intact, including any previous resolution audit history.
  update public.content_items set payload = jsonb_set(payload, '{routeId}', to_jsonb(keep_id::text))
    where kind = 'activity' and payload ->> 'routeId' in (select id::text from unnest(losers) as ids(id));
  return jsonb_build_object('winnerId', keep_id, 'archivedIds', to_jsonb(losers), 'resolution', audit);
end;
$function$;

create function public.save_activity_with_track(activity_record jsonb)
returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public
set lock_timeout = '5s'
as $function$
declare
  actor uuid := auth.uid();
  activity_id uuid;
  activity_payload jsonb;
  activity_published boolean;
  activity_created timestamptz;
  existing public.content_items%rowtype;
  saved public.content_items%rowtype;
  automatic public.content_items%rowtype;
  linked public.content_items%rowtype;
  automatic_count integer;
  has_automatic boolean := false;
  has_linked boolean := false;
  has_track boolean := false;
  track jsonb;
  stats jsonb;
  distance_m numeric;
  ascent_m numeric;
  point jsonb;
  route_payload jsonb;
  route_title text;
  next_id uuid;
  visited uuid[] := '{}'::uuid[];
  key text;
  at_time timestamptz := transaction_timestamp();
begin
  if actor is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception using errcode = '42501', message = 'Only verified administrators may save activity tracks.';
  end if;
  if jsonb_typeof(activity_record) is distinct from 'object'
     or activity_record ->> 'kind' is distinct from 'activity'
     or jsonb_typeof(activity_record -> 'payload') is distinct from 'object'
     or jsonb_typeof(activity_record #> '{payload,title}') is distinct from 'string'
     or public.route_title_key(activity_record #>> '{payload,title}') = '' then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY';
  end if;
  begin
    activity_id := (activity_record ->> 'id')::uuid;
    if activity_id is null then raise invalid_text_representation; end if;
    activity_created := coalesce((activity_record ->> 'created_at')::timestamptz, at_time);
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_ID_OR_DATE';
  end;
  if activity_record ? 'published' and jsonb_typeof(activity_record -> 'published') is distinct from 'boolean' then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY_PUBLICATION';
  end if;
  activity_published := coalesce((activity_record ->> 'published')::boolean, false);
  activity_payload := activity_record -> 'payload';
  activity_payload := activity_payload || jsonb_build_object('isDemo', false);
  if activity_payload ? 'routeName' and jsonb_typeof(activity_payload -> 'routeName') not in ('string', 'null') then
    raise exception using errcode = '22023', message = 'INVALID_ACTIVITY';
  end if;
  if activity_payload ? 'track' and jsonb_typeof(activity_payload -> 'track') not in ('object', 'null') then
    raise exception using errcode = '22023', message = 'INVALID_TRACK';
  end if;
  if activity_payload ? 'trackLocalId' and jsonb_typeof(activity_payload -> 'track') is distinct from 'object' then
    raise exception using errcode = '22023', message = 'LOCAL_TRACK_MUST_BE_LOADED_BEFORE_CLOUD_SAVE';
  end if;
  has_track := jsonb_typeof(activity_payload -> 'track') = 'object';
  has_track := coalesce(has_track, false);
  if has_track then
    track := activity_payload -> 'track';
    stats := track -> 'stats';
    if jsonb_typeof(stats) is distinct from 'object'
       or jsonb_typeof(stats -> 'distanceM') is distinct from 'number'
       or (stats ? 'ascentM' and jsonb_typeof(stats -> 'ascentM') not in ('number', 'null')) then
      raise exception using errcode = '22023', message = 'INVALID_TRACK';
    end if;
    distance_m := (stats ->> 'distanceM')::numeric;
    ascent_m := (stats ->> 'ascentM')::numeric;
    if distance_m < 0 or distance_m > 1e14 or ascent_m < 0 or ascent_m > 1e14 then
      raise exception using errcode = '22023', message = 'INVALID_TRACK';
    end if;
    activity_payload := (activity_payload - 'trackLocalId') || jsonb_build_object(
      'distance', distance_m / 1000, 'ascent', ascent_m,
      'footprintEligible', activity_payload -> 'archived' is distinct from 'true'::jsonb);
    point := activity_payload -> 'coordinates';
    if not (case when jsonb_typeof(point) = 'array' then
      case when jsonb_array_length(point) = 2 and jsonb_typeof(point -> 0) = 'number' and jsonb_typeof(point -> 1) = 'number'
        then abs((point ->> 0)::numeric) <= 180 and abs((point ->> 1)::numeric) <= 90 else false end
      else false end) then
      point := case track #>> '{geojson,geometry,type}'
        when 'MultiLineString' then track #> '{geojson,geometry,coordinates,0,0}'
        when 'LineString' then track #> '{geojson,geometry,coordinates,0}' else null end;
    end if;
    if (case when jsonb_typeof(point) = 'array' then
      case when jsonb_array_length(point) >= 2 and jsonb_typeof(point -> 0) = 'number' and jsonb_typeof(point -> 1) = 'number'
        then abs((point ->> 0)::numeric) <= 180 and abs((point ->> 1)::numeric) <= 90 else false end
      else false end) then
      activity_payload := jsonb_set(activity_payload, '{coordinates}', jsonb_build_array(point -> 0, point -> 1));
    else activity_payload := activity_payload - 'coordinates'; end if;
  end if;

  lock table public.content_items in share row exclusive mode nowait;
  select * into existing from public.content_items where id = activity_id for update;
  if found then
    if existing.kind <> 'activity' then raise exception using errcode = '22023', message = 'ID_CONFLICT'; end if;
    activity_created := existing.created_at;
  end if;
  select count(*) into automatic_count from public.content_items
    where kind = 'route' and payload ->> 'generatedFromActivityId' = activity_id::text;
  if automatic_count > 1 then raise exception using errcode = '22023', message = 'AMBIGUOUS_GENERATED_ROUTE'; end if;
  if automatic_count = 1 then
    select * into automatic from public.content_items
      where kind = 'route' and payload ->> 'generatedFromActivityId' = activity_id::text for update;
    has_automatic := true;
  end if;

  if not has_track then
    activity_payload := (activity_payload - array['track','trackLocalId','trackSummary','coordinates',
      'province','city','provinceCode','cityCode','locations','locationStatus'])
      || jsonb_build_object('includeFootprint', false, 'footprintEligible', false);
    if has_automatic or activity_payload ->> 'routeLinkSource' = 'activity-track'
       or existing.payload ->> 'routeLinkSource' = 'activity-track' then
      activity_payload := activity_payload - array['routeId','routeLinkSource'];
    end if;
    if has_automatic and automatic.payload -> 'archived' is distinct from 'true'::jsonb
       and not (case when jsonb_typeof(automatic.payload -> 'duplicateResolutions') = 'array'
         then jsonb_array_length(automatic.payload -> 'duplicateResolutions') > 0 else false end)
       and not exists (select 1 from public.content_items where kind = 'activity'
         and id <> activity_id and payload ->> 'routeId' = automatic.id::text) then
      update public.content_items set published = false, payload = payload || jsonb_build_object(
        'archived', true, 'archivedReason', 'activity-track-removed', 'archivedAt', at_time)
        where id = automatic.id;
    end if;
  else
    if has_automatic and automatic.payload -> 'archived' = 'true'::jsonb
       and automatic.payload ->> 'archivedReason' = 'duplicate' then
      linked := automatic;
      visited := array[automatic.id];
      while linked.payload -> 'archived' = 'true'::jsonb and linked.payload ->> 'archivedReason' = 'duplicate' loop
        begin next_id := (linked.payload ->> 'duplicateWinnerId')::uuid;
        exception when invalid_text_representation then raise exception using errcode = '22023', message = 'ARCHIVED_ROUTE_UNAVAILABLE'; end;
        if next_id is null or next_id = any(visited) then raise exception using errcode = '22023', message = 'ARCHIVED_ROUTE_UNAVAILABLE'; end if;
        visited := array_append(visited, next_id);
        select * into linked from public.content_items where id = next_id and kind = 'route' for update;
        if not found or linked.payload -> 'archived' = 'true'::jsonb and linked.payload ->> 'archivedReason' is distinct from 'duplicate' then
          raise exception using errcode = '22023', message = 'ARCHIVED_ROUTE_UNAVAILABLE';
        end if;
      end loop;
      has_linked := true;
      -- Preserve the chosen winner's geometry, title, publication and history.
    elsif has_automatic and automatic.payload -> 'archived' is distinct from 'true'::jsonb
       and (case when jsonb_typeof(automatic.payload -> 'duplicateResolutions') = 'array'
         then jsonb_array_length(automatic.payload -> 'duplicateResolutions') > 0 else false end) then
      -- The original owner can update its own activity track, but after a
      -- resolution it cannot implicitly rewrite the administratively chosen route.
      linked := automatic;
      has_linked := true;
    else
      if has_automatic and automatic.payload -> 'archived' = 'true'::jsonb
         and automatic.payload ->> 'archivedReason' is distinct from 'activity-track-removed' then
        raise exception using errcode = '22023', message = 'GENERATED_ROUTE_ARCHIVED';
      end if;
      route_payload := case when has_automatic then automatic.payload else '{}'::jsonb end;
      foreach key in array array['description','image','difficulty','location','coordinates','province','city',
        'provinceCode','cityCode','locations','locationStatus','track','trackSummary'] loop
        if activity_payload ? key then route_payload := jsonb_set(route_payload, array[key], activity_payload -> key);
        else route_payload := route_payload - key; end if;
      end loop;
      -- Explicit administrator title, then actual file/summary name, finally the
      -- activity title. Ignore non-string/blank candidates instead of guessing.
      select btrim(candidate, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
        into route_title from (values
          (1, case when jsonb_typeof(activity_payload -> 'routeName') = 'string' then activity_payload ->> 'routeName' end),
          (2, case when jsonb_typeof(activity_payload #> '{track,name}') = 'string' then activity_payload #>> '{track,name}' end),
          (3, case when jsonb_typeof(activity_payload #> '{trackSummary,name}') = 'string' then activity_payload #>> '{trackSummary,name}' end),
          (4, activity_payload ->> 'title')) as names(priority, candidate)
        where public.route_title_key(candidate) <> '' order by priority limit 1;
      route_payload := (route_payload - array['trackLocalId','archived','archivedReason','archivedAt','archivedBy'])
        || jsonb_build_object('title', route_title,
          'generatedFromActivityId', activity_id::text, 'source', '活动关联路线',
          'isDemo', false, 'verified', false, 'distance', distance_m / 1000, 'ascent', ascent_m);
      if has_automatic then
        update public.content_items set payload = route_payload,
          published = activity_published and activity_payload -> 'archived' is distinct from 'true'::jsonb
          where id = automatic.id and kind = 'route' returning * into linked;
      else
        insert into public.content_items(id, kind, payload, published, created_at)
          values (gen_random_uuid(), 'route', route_payload,
            activity_published and activity_payload -> 'archived' is distinct from 'true'::jsonb, activity_created)
          returning * into linked;
      end if;
      if not found then raise exception using errcode = '42501', message = 'ROUTE_WRITE_DENIED'; end if;
      has_linked := true;
    end if;
    activity_payload := activity_payload || jsonb_build_object('routeId', linked.id::text, 'routeLinkSource', 'activity-track');
  end if;
  insert into public.content_items(id, kind, payload, published, created_at)
    values (activity_id, 'activity', activity_payload, activity_published, activity_created)
    on conflict (id) do update set payload = excluded.payload, published = excluded.published
      where public.content_items.kind = 'activity'
    returning * into saved;
  if not found then raise exception using errcode = '42501', message = 'ACTIVITY_WRITE_DENIED'; end if;
  return jsonb_build_object('activity', to_jsonb(saved), 'route', case when has_linked then to_jsonb(linked) else 'null'::jsonb end);
end;
$function$;

create function public.delete_content_with_links(content_id uuid)
returns jsonb
language plpgsql security invoker
set search_path = pg_catalog, public
set lock_timeout = '5s'
as $function$
declare
  actor uuid := auth.uid();
  target public.content_items%rowtype;
begin
  if actor is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception using errcode = '42501', message = 'Only verified administrators may delete linked content.';
  end if;
  if content_id is null then raise exception using errcode = '22023', message = 'CONTENT_NOT_FOUND'; end if;
  lock table public.content_items in share row exclusive mode nowait;
  select * into target from public.content_items where id = content_id for update;
  if not found then raise exception using errcode = '22023', message = 'CONTENT_NOT_FOUND'; end if;
  if target.kind = 'route' and (
    exists (select 1 from public.content_items where kind = 'activity'
      and (payload ->> 'routeId' = content_id::text or id::text = target.payload ->> 'generatedFromActivityId'))
    or exists (select 1 from public.content_items where id <> content_id and payload ->> 'duplicateWinnerId' = content_id::text)
  ) then raise exception using errcode = '22023', message = 'CONTENT_IN_USE'; end if;
  if target.kind = 'activity' then
    -- Reuse exactly the same removal rules under the same transaction/table lock.
    -- A foreign-key restriction (e.g. existing applications) rolls back this
    -- cleanup as well as the deletion; no half-archived route is left behind.
    perform public.save_activity_with_track(jsonb_build_object('id', target.id,
      'kind', 'activity', 'payload', target.payload - array['track','trackLocalId','trackSummary'],
      'published', target.published, 'created_at', target.created_at));
  end if;
  delete from public.content_items where id = content_id;
  if not found then raise exception using errcode = '42501', message = 'CONTENT_DELETE_DENIED'; end if;
  return jsonb_build_object('deletedId', content_id);
end;
$function$;

-- EXECUTE is PUBLIC by default; all state-changing RPCs and their normalization
-- helper are explicitly limited. RLS/table grants remain in force (INVOKER).
revoke all on function public.route_title_key(text) from public, anon, authenticated;
revoke all on function public.resolve_route_duplicates(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.save_activity_with_track(jsonb) from public, anon, authenticated;
revoke all on function public.delete_content_with_links(uuid) from public, anon, authenticated;
grant execute on function public.route_title_key(text) to authenticated;
grant execute on function public.resolve_route_duplicates(uuid[], uuid) to authenticated;
grant execute on function public.save_activity_with_track(jsonb) to authenticated;
grant execute on function public.delete_content_with_links(uuid) to authenticated;
commit;
