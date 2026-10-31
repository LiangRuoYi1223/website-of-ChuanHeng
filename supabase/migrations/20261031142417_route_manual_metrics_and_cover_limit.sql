-- Targeted follow-up: no existing content, snapshot, object, MIME or policy rewrite.
begin;

-- Mirrors validateManualTrackMetrics / resolvedTrackMetrics. Tolerant mode is
-- reserved for restoring immutable historical tracks with unknown old values.
create function public.resolve_route_track_metrics(track jsonb, strict boolean default true) returns jsonb
language plpgsql stable security invoker set search_path = pg_catalog, public
as $fn$
declare
  raw jsonb := case when jsonb_typeof(track->'stats')='object' then track->'stats' else track end;
  manual jsonb := track->'manualMetrics';
  result jsonb := '{"distanceM":null,"ascentM":null,"sources":{}}'::jsonb;
  field text;
  source_key text;
  value jsonb;
  raw_known boolean;
  manual_valid boolean := true;
begin
  if manual is not null and manual <> 'null'::jsonb then
    if jsonb_typeof(manual) is distinct from 'object'
      or manual->>'source' is distinct from 'administrator'
      or jsonb_typeof(manual->'confirmedAt') is distinct from 'string'
      or public.activity_iso_time(manual->>'confirmedAt') is null then
      manual_valid := false;
    end if;
    foreach field in array array['distanceM','ascentM'] loop
      value := manual->field;
      if value is null or value='null'::jsonb then continue; end if;
      if jsonb_typeof(value) is distinct from 'number' then manual_valid := false;
      elsif (value#>>'{}')::numeric<0 or (value#>>'{}')::numeric>1.7976931348623157e308 then manual_valid := false;
      end if;
      if jsonb_typeof(raw->field)='number' then
        if (raw->>field)::numeric between 0 and 1.7976931348623157e308 then manual_valid := false; end if;
      end if;
    end loop;
    if not manual_valid then
      if strict then raise exception using errcode='22023',message='INVALID_MANUAL_TRACK_METRICS'; end if;
      manual := null;
    end if;
  end if;
  foreach field in array array['distanceM','ascentM'] loop
    source_key := case field when 'distanceM' then 'distance' else 'ascent' end;
    value := raw->field;
    raw_known := false;
    if jsonb_typeof(value)='number' then
      raw_known := (value#>>'{}')::numeric between 0 and 1.7976931348623157e308;
    end if;
    if strict and value is not null and value<>'null'::jsonb and not raw_known then
      raise exception using errcode='22023',message='INVALID_ROUTE_TRACK';
    end if;
    if raw_known then
      result := jsonb_set(result,array[field],value);
      result := jsonb_set(result,array['sources',source_key],'"track"');
    elsif manual->field is not null and manual->field<>'null'::jsonb then
      result := jsonb_set(result,array[field],manual->field);
      result := jsonb_set(result,array['sources',source_key],'"administrator"');
    else
      result := jsonb_set(result,array['sources',source_key],'"unavailable"');
    end if;
  end loop;
  return result;
end;
$fn$;
revoke all on function public.resolve_route_track_metrics(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.resolve_route_track_metrics(jsonb,boolean) to authenticated;

create or replace function public.guard_activity_route_content() returns trigger
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
  if new.kind = 'route' and new.payload#>'{track,manualMetrics}' is not null
    and new.payload#>'{track,manualMetrics}' <> 'null'::jsonb then
    perform public.resolve_route_track_metrics(new.payload->'track');
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
      stats := public.resolve_route_track_metrics(selected.payload->'track');
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
      snap := snap || jsonb_build_object('distance',(stats->>'distanceM')::numeric/1000,'ascent',(stats->>'ascentM')::numeric,'metricSources',stats->'sources');
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
    foreach key in array array['distance','ascent','metricSources','coordinates','location','province','city','provinceCode','cityCode','locations','locationStatus'] loop
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
    new.payload := new.payload-array['distance','ascent','metricSources','coordinates','location','province','city','provinceCode','cityCode','adcode','locations','locationStatus'];
    legacy_source := case when jsonb_typeof(previous->'track')='object' then previous->'track' else previous->'trackSummary' end;
    stats := case when jsonb_typeof(legacy_source->'stats')='object' then legacy_source->'stats'
      when jsonb_typeof(previous#>'{trackSummary,stats}')='object' then previous#>'{trackSummary,stats}' else legacy_source end;
    native_location := case when jsonb_typeof(legacy_source->'location')='object' then legacy_source->'location'
      when jsonb_typeof(previous#>'{trackSummary,location}')='object' then previous#>'{trackSummary,location}' else '{}'::jsonb end;
    -- Historical malformed supplements are ignored; valid raw values survive.
    stats := public.resolve_route_track_metrics(jsonb_build_object('stats',stats,
      'manualMetrics',legacy_source->'manualMetrics'),false);
    new.payload := new.payload || jsonb_build_object('distance',(stats->>'distanceM')::numeric/1000,
      'ascent',(stats->>'ascentM')::numeric,'metricSources',stats->'sources');
    legacy_usable := stats->'distanceM' <> 'null'::jsonb;
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
    new.payload := (new.payload-array['distance','ascent','metricSources','coordinates','location','province','city','provinceCode','cityCode','locations','locationStatus'])
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

update storage.buckets set file_size_limit=3145728 where id='activity-covers';

commit;
