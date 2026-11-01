begin;
-- Contact data is independent of durable membership and immutable payment history.
create table private.member_profiles(user_id uuid primary key references auth.users(id),username text not null,real_name text not null,phone text not null,updated_at timestamptz not null);
create table private.activity_registration_details(application_id uuid primary key references public.applications(id),id_number text not null,phone text not null,updated_at timestamptz not null);
alter table public.applications add column insurance_status text not null default 'uninsured' check(insurance_status in ('uninsured','insured')),add column registration_real_name text,add column details_updated_at timestamptz;
alter table public.application_payment_proofs alter column object_path drop not null,add column purged_at timestamptz;
create table private.activity_data_cleanup(activity_id uuid primary key references public.content_items(id),mode text not null check(mode in ('manual','automatic')),status text not null check(status in ('cleaning','verifying','completed')),lease_id uuid,lease_until timestamptz,last_round_slot bigint,next_attempt_at timestamptz not null default clock_timestamp(),consecutive_empty_checks integer not null default 0,last_checked_at timestamptz,cleared_at timestamptz,error_code text);
create table private.cleanup_confirmations(id uuid primary key default gen_random_uuid(),activity_id uuid not null references public.content_items(id),user_id uuid not null,expires_at timestamptz not null,activity_payload jsonb not null,stage integer not null default 1,counts jsonb not null);
alter table private.member_profiles enable row level security;
alter table private.activity_registration_details enable row level security;
alter table private.activity_data_cleanup enable row level security;
alter table private.cleanup_confirmations enable row level security;
revoke all on private.member_profiles,private.activity_registration_details,private.activity_data_cleanup,private.cleanup_confirmations from public,anon,authenticated;
revoke all on public.registration_events,public.payment_settings_events from public,anon,authenticated;
alter table public.registration_events drop constraint registration_events_action_check;
alter table public.registration_events add constraint registration_events_action_check check(action in ('registered','withdrawn','rejoined','payment_changed','capacity_changed','payment_proof_submitted','insurance_changed','insurance_exported','cleanup_requested','cleanup_checked'));
update storage.buckets set file_size_limit=1048576 where id='payment-proofs';
create function private.member_identity(p_expected uuid default null,p_admin boolean default false) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' or not exists(select 1 from auth.users where id=auth.uid()) then raise exception 'AUTH_REQUIRED';end if;
 if p_expected is not null and p_expected is distinct from auth.uid() then raise exception 'AUTH_CHANGED';end if;
 if p_admin and coalesce(auth.jwt()#>>'{app_metadata,role}','')<>'admin' then raise exception 'ADMIN_REQUIRED';end if;
 return auth.uid();end;$$;
create function private.activity_sensitive_open(p_activity_id uuid) returns boolean language sql security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.content_items c where c.id=p_activity_id and c.kind='activity' and (public.activity_iso_time(c.payload->>'dateEnd') is null or public.activity_iso_time(c.payload->>'dateEnd')>clock_timestamp()) and not exists(select 1 from private.activity_data_cleanup q where q.activity_id=c.id and (q.mode='automatic' or q.status<>'completed')))
$$;
create function private.retention_state(p_activity_id uuid) returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('dueAt',public.activity_iso_time(c.payload->>'dateEnd'),'status',case when q.mode='automatic' or q.status in ('cleaning','verifying') then q.status when public.activity_iso_time(c.payload->>'dateEnd') is null then 'missing_end' when public.activity_iso_time(c.payload->>'dateEnd')<=clock_timestamp() then 'waiting' else 'waiting' end,'lastCheckedAt',q.last_checked_at,'consecutiveEmptyChecks',coalesce(q.consecutive_empty_checks,0),'manualAllowed',coalesce(public.activity_iso_time(c.payload->>'registrationStart')<=clock_timestamp() and not exists(select 1 from private.activity_data_cleanup z where z.activity_id=c.id and (z.mode='automatic' or z.status<>'completed')),false),'clearedAt',q.cleared_at) from public.content_items c left join private.activity_data_cleanup q on q.activity_id=c.id where c.id=p_activity_id
$$;
create function private.get_member_profile() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid:=private.member_identity();r private.member_profiles%rowtype;
begin select * into r from private.member_profiles where user_id=u;return jsonb_build_object('userId',u,'username',coalesce(r.username,''),'realName',coalesce(r.real_name,''),'phone',coalesce(r.phone,''),'updatedAt',r.updated_at);end;$$;
create function private.save_member_profile(p_username text,p_real_name text,p_phone text,p_expected_updated_at timestamptz,p_expected_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare u uuid; r private.member_profiles%rowtype;
begin u:=private.member_identity(p_expected_user_id);if p_expected_user_id is null then raise exception 'AUTH_CHANGED';end if;
 perform 1 from auth.users where id=u for update;
 if p_username is null or length(btrim(p_username)) not between 1 and 60 or p_real_name is null or length(btrim(p_real_name))>80 or p_phone is null or (p_phone<>'' and p_phone!~'^1[3-9][0-9]{9}$') then raise exception 'INVALID_PROFILE';end if;
 select * into r from private.member_profiles where user_id=u;
 if r.updated_at is distinct from p_expected_updated_at then raise exception 'STALE_PROFILE';end if;
 insert into private.member_profiles values(u,btrim(p_username),btrim(p_real_name),p_phone,greatest(clock_timestamp(),r.updated_at+interval '1 microsecond')) on conflict(user_id) do update set username=excluded.username,real_name=excluded.real_name,phone=excluded.phone,updated_at=excluded.updated_at;
 return private.get_member_profile();end;$$;
create function private.validate_insurance_details(p_real_name text,p_id_number text,p_phone text,p_consent boolean) returns void language plpgsql set search_path=pg_catalog,public as $$
declare n text:=upper(btrim(p_id_number));s integer:=0;i integer;weights integer[]:=array[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];birth date;
begin
 if p_consent is distinct from true or p_real_name is null or length(btrim(p_real_name)) not between 1 and 80 or p_phone is null or p_phone!~'^1[3-9][0-9]{9}$' or n is null or (n!~'^[1-9][0-9]{16}[0-9X]$' or substring(n,15,3)='000') then raise exception 'INVALID_INSURANCE_DETAILS';end if;
 begin birth:=make_date(substring(n,7,4)::integer,substring(n,11,2)::integer,substring(n,13,2)::integer);exception when others then raise exception 'INVALID_ID_DATE';end;
 if birth>current_date or birth<date '1800-01-01' then raise exception 'INVALID_ID_DATE';end if;
 for i in 1..17 loop s:=s+substring(n,i,1)::integer*weights[i];end loop;
 if substring('10X98765432',s%11+1,1)<>right(n,1) then raise exception 'INVALID_ID_CHECKSUM';end if;end;$$;
-- Preserve the old queue implementation but remove every client-callable path to it.
drop function public.register_activity(uuid,uuid);
alter function private.register_activity(uuid,uuid) rename to register_activity_queue;
revoke all on function private.register_activity_queue(uuid,uuid) from public,anon,authenticated;
create function private.save_activity_registration_details(p_activity_id uuid,p_expected_user_id uuid,p_real_name text,p_id_number text,p_phone text,p_consent boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set row_security=off as $$
declare a public.applications%rowtype;stamp timestamptz;
begin perform private.member_identity(p_expected_user_id);if p_expected_user_id is null then raise exception 'AUTH_CHANGED';end if;
 perform 1 from public.content_items where id=p_activity_id for update;
 if not private.activity_sensitive_open(p_activity_id) then raise exception 'ACTIVITY_DATA_CLOSED';end if;
 perform private.validate_insurance_details(p_real_name,p_id_number,p_phone,p_consent);
 select * into a from public.applications where activity_id=p_activity_id and user_id=auth.uid() for update;
 if not found or a.registration_status<>'active' then raise exception 'ACTIVE_REGISTRATION_REQUIRED';end if;
 if a.insurance_status='insured' then raise exception 'INSURED_DETAILS_LOCKED';end if;
 stamp:=greatest(clock_timestamp(),a.details_updated_at+interval '1 microsecond');
 insert into private.activity_registration_details values(a.id,upper(btrim(p_id_number)),p_phone,stamp) on conflict(application_id) do update set id_number=excluded.id_number,phone=excluded.phone,updated_at=excluded.updated_at;
 update public.applications set registration_real_name=btrim(p_real_name),details_updated_at=stamp where id=a.id;
 return private.registration_state(p_activity_id);end;$$;
create function private.register_activity(p_activity_id uuid,p_expected_user_id uuid,p_real_name text,p_id_number text,p_phone text,p_consent boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin perform private.member_identity(p_expected_user_id);if p_expected_user_id is null then raise exception 'AUTH_CHANGED';end if;
 perform 1 from public.content_items where id=p_activity_id for update;
 if not private.activity_sensitive_open(p_activity_id) then raise exception 'ACTIVITY_DATA_CLOSED';end if;
 perform private.validate_insurance_details(p_real_name,p_id_number,p_phone,p_consent);
 perform private.register_activity_queue(p_activity_id,p_expected_user_id);
 -- Rejoining preserves an existing insurance contract when the normalized details
 -- are identical. The queue write rolls back if any insured field differs.
 if exists(select 1 from public.applications where activity_id=p_activity_id and user_id=auth.uid() and insurance_status='insured') then
  if not exists(select 1 from public.applications a join private.activity_registration_details d on d.application_id=a.id
   where a.activity_id=p_activity_id and a.user_id=auth.uid() and a.registration_real_name=btrim(p_real_name)
   and d.id_number=upper(btrim(p_id_number)) and d.phone=p_phone) then raise exception 'INSURED_DETAILS_LOCKED';end if;
  return private.registration_state(p_activity_id);
 end if;
 return private.save_activity_registration_details(p_activity_id,p_expected_user_id,p_real_name,p_id_number,p_phone,p_consent);end;$$;
create function private.get_member_activity_history() returns jsonb language plpgsql security definer set search_path=pg_catalog,public set row_security=off as $$
declare u uuid:=private.member_identity();result jsonb;
begin select coalesce(jsonb_agg(jsonb_build_object('activityId',a.activity_id,'title',c.payload->>'title','dateStart',c.payload->>'dateStart','dateEnd',c.payload->>'dateEnd','registeredAt',a.registered_at,'status',a.registration_status,'selectionStatus',case when a.registration_status='withdrawn' then 'withdrawn' when (case when jsonb_typeof(c.payload->'registrationCapacity')='number' then (c.payload->>'registrationCapacity')::numeric between 1 and 100000 and trunc((c.payload->>'registrationCapacity')::numeric)=(c.payload->>'registrationCapacity')::numeric else false end) is not true then 'unconfirmed' when (select count(*) from public.applications x where x.activity_id=a.activity_id and x.registration_status='active' and (x.registered_at,x.id)<=(a.registered_at,a.id))<=(c.payload->>'registrationCapacity')::integer then 'confirmed' else 'waitlisted' end,'paymentStatus',a.payment_status,'insuranceStatus',a.insurance_status) order by a.registered_at desc),'[]'::jsonb) into result from public.applications a join public.content_items c on c.id=a.activity_id where a.user_id=u;
 return jsonb_build_object('viewerId',u,'activities',result);end;$$;
create function private.insurance_audit(p_activity uuid,p_action text,p_details jsonb) returns void language sql security definer set search_path=pg_catalog,public as $$
 insert into public.registration_events(activity_id,action,actor_id,actor_label,actor_type,source,details) values(p_activity,p_action,coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid),case when auth.uid() is null then 'automatic' else 'administrator' end,case when auth.uid() is null then 'system' else 'admin' end,case when auth.uid() is null then 'automatic' else 'manual' end,p_details)
$$;
create function private.set_activity_registration_insurance(p_application_id uuid,p_insurance_status text,p_expected_insurance_status text,p_expected_user_id uuid,p_expected_details_updated_at timestamptz) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set row_security=off as $$
declare a public.applications%rowtype;s jsonb;
begin perform private.member_identity(p_expected_user_id,true);if p_expected_user_id is null then raise exception 'AUTH_CHANGED';end if;
 select * into a from public.applications where id=p_application_id;
 if not found then raise exception 'APPLICATION_NOT_FOUND';end if;
 perform 1 from public.content_items where id=a.activity_id for update;select * into a from public.applications where id=p_application_id for update;
 if a.insurance_status is distinct from p_expected_insurance_status or a.details_updated_at is distinct from p_expected_details_updated_at then raise exception 'STALE_INSURANCE_DETAILS';end if;
 if p_insurance_status is null or p_insurance_status not in ('insured','uninsured') then raise exception 'INVALID_INSURANCE_STATUS';end if;
 s:=private.registration_state(a.activity_id,true);
 if p_insurance_status='insured' and (not private.activity_sensitive_open(a.activity_id) or not exists(select 1 from jsonb_array_elements(s->'applications') x where x->>'id'=a.id::text and x->>'selectionStatus'='confirmed' and x->>'detailsComplete'='true')) then raise exception 'INSURANCE_NOT_ELIGIBLE';end if;
 if a.insurance_status<>p_insurance_status then update public.applications set insurance_status=p_insurance_status where id=a.id;perform private.insurance_audit(a.activity_id,'insurance_changed',jsonb_build_object('applicationId',a.id,'before',a.insurance_status,'after',p_insurance_status));end if;
 return private.registration_state(a.activity_id,true);end;$$;
create function private.export_activity_insurance(p_activity_id uuid,p_expected_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set row_security=off as $$
declare s jsonb;rows jsonb;
begin perform private.member_identity(p_expected_user_id,true);if p_expected_user_id is null then raise exception 'AUTH_CHANGED';end if;
 perform 1 from public.content_items where id=p_activity_id for update;if not private.activity_sensitive_open(p_activity_id) then raise exception 'ACTIVITY_DATA_CLOSED';end if;
 s:=private.registration_state(p_activity_id,true);
 select coalesce(jsonb_agg(jsonb_build_object('applicationId',a.id,'realName',a.registration_real_name,'idNumber',d.id_number,'phone',d.phone,'insuranceStatus',a.insurance_status,'position',(x->>'position')::integer,'detailsComplete',d.application_id is not null) order by (x->>'position')::integer),'[]'::jsonb) into rows from jsonb_array_elements(s->'applications') x join public.applications a on a.id=(x->>'id')::uuid left join private.activity_registration_details d on d.application_id=a.id where x->>'selectionStatus'='confirmed';
 perform private.insurance_audit(p_activity_id,'insurance_exported',jsonb_build_object('count',jsonb_array_length(rows)));
 return jsonb_build_object('viewerId',auth.uid(),'activityId',p_activity_id,'title',(select payload->>'title' from public.content_items where id=p_activity_id),'exportedAt',clock_timestamp(),'rows',rows);end;$$;
create function private.prepare_activity_data_cleanup(p_activity_id uuid,p_expected_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.content_items%rowtype;t private.cleanup_confirmations%rowtype;counts jsonb;
begin perform private.member_identity(p_expected_user_id,true);if p_expected_user_id is null then raise exception 'AUTH_CHANGED';end if;
 select * into c from public.content_items where id=p_activity_id and kind='activity' for update;
 if not found or not coalesce(public.activity_iso_time(c.payload->>'registrationStart')<=clock_timestamp(),false) or exists(select 1 from private.activity_data_cleanup where activity_id=c.id and (mode='automatic' or status<>'completed')) then raise exception 'CLEANUP_UNAVAILABLE';end if;
 select jsonb_build_object('applicationCount',count(*),'detailsCount',(select count(*) from private.activity_registration_details d join public.applications a on a.id=d.application_id where a.activity_id=c.id),'proofCount',(select count(*) from storage.objects o where o.bucket_id='payment-proofs' and exists(select 1 from public.applications a where a.activity_id=c.id and starts_with(o.name,a.user_id::text||'/'||a.id::text||'/')))) into counts from public.applications where activity_id=c.id;
 insert into private.cleanup_confirmations(activity_id,user_id,expires_at,activity_payload,counts) values(c.id,auth.uid(),clock_timestamp()+interval '5 minutes',c.payload,counts) returning * into t;
 return counts||jsonb_build_object('confirmationId',t.id,'activityId',c.id,'expiresAt',t.expires_at);end;$$;
create function private.confirm_activity_data_cleanup(p_confirmation_id uuid,p_expected_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare t private.cleanup_confirmations%rowtype;c public.content_items%rowtype;
begin perform private.member_identity(p_expected_user_id,true);if p_expected_user_id is null then raise exception 'AUTH_CHANGED';end if;
 select * into t from private.cleanup_confirmations where id=p_confirmation_id;
 select * into c from public.content_items where id=t.activity_id for update;
 select * into t from private.cleanup_confirmations where id=p_confirmation_id for update;
 if t.id is null or t.user_id<>auth.uid() or t.expires_at<=clock_timestamp() or t.activity_payload is distinct from c.payload or t.stage<>1 then raise exception 'INVALID_CLEANUP_CONFIRMATION';end if;
 update private.cleanup_confirmations set stage=2 where id=t.id;
 return t.counts||jsonb_build_object('confirmationId',t.id,'activityId',t.activity_id,'expiresAt',t.expires_at);end;$$;
create function private.execute_activity_data_cleanup(p_confirmation_id uuid,p_expected_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare t private.cleanup_confirmations%rowtype;c public.content_items%rowtype;
begin perform private.member_identity(p_expected_user_id,true);if p_expected_user_id is null then raise exception 'AUTH_CHANGED';end if;
 select * into t from private.cleanup_confirmations where id=p_confirmation_id;
 select * into c from public.content_items where id=t.activity_id for update;
 select * into t from private.cleanup_confirmations where id=p_confirmation_id for update;
 if t.id is null or t.user_id<>auth.uid() or t.expires_at<=clock_timestamp() or t.activity_payload is distinct from c.payload or t.stage<>2 then raise exception 'INVALID_CLEANUP_CONFIRMATION';end if;
 if exists(select 1 from private.activity_data_cleanup where activity_id=c.id and (mode='automatic' or status<>'completed')) then raise exception 'CLEANUP_UNAVAILABLE';end if;
 delete from private.cleanup_confirmations where id=t.id;
 insert into private.activity_data_cleanup(activity_id,mode,status) values(c.id,'manual','cleaning') on conflict(activity_id) do update set mode='manual',status='cleaning',lease_id=null,lease_until=null,next_attempt_at=clock_timestamp(),consecutive_empty_checks=0;
 perform private.insurance_audit(c.id,'cleanup_requested',t.counts);
 return private.registration_state(c.id,true);end;$$;
-- Access is limited by function grants to the service role, never by caller data.
create function private.list_activity_cleanup_objects(p_activity_id uuid,p_lease_id uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare paths jsonb;
begin
 if not exists(select 1 from private.activity_data_cleanup where activity_id=p_activity_id and lease_id=p_lease_id and lease_until>clock_timestamp() and status<>'completed') then raise exception 'INVALID_CLEANUP_LEASE';end if;
 select coalesce(jsonb_agg(name),'[]'::jsonb) into paths from (select o.name from storage.objects o where o.bucket_id='payment-proofs' and exists(select 1 from public.applications a where a.activity_id=p_activity_id and starts_with(o.name,a.user_id::text||'/'||a.id::text||'/')) order by o.name limit least(greatest(coalesce(p_limit,100),1),100)) found;
 return jsonb_build_object('objectPaths',paths);end;$$;
create function private.claim_activity_data_cleanup(p_limit integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set row_security=off as $$
declare c public.content_items%rowtype;q private.activity_data_cleanup%rowtype;jobs jsonb:='[]'::jsonb;paths jsonb;end_at timestamptz;round_slot bigint:=floor(extract(epoch from clock_timestamp())/180)::bigint;
begin
 -- Activity lock is shared with registration, details, confirmation, and Storage inserts.
 for c in
  select x.* from public.content_items x left join private.activity_data_cleanup z on z.activity_id=x.id
  where x.kind='activity' and (z.last_round_slot is null or z.last_round_slot<round_slot)
  and (z.lease_until is null or z.lease_until<=clock_timestamp())
  and ((z.status<>'completed' and z.next_attempt_at<=clock_timestamp())
   or (public.activity_iso_time(x.payload->>'dateEnd')<=clock_timestamp() and (z.activity_id is null or (z.mode='manual' and z.status='completed'))))
  -- Oldest waiting work precedes fresh retries, so failing low UUIDs cannot starve it.
  order by coalesce(case when z.status<>'completed' then z.next_attempt_at end,public.activity_iso_time(x.payload->>'dateEnd')),x.id
  for update of x skip locked limit least(greatest(coalesce(p_limit,10),1),10) loop
  end_at:=public.activity_iso_time(c.payload->>'dateEnd');
  insert into private.activity_data_cleanup(activity_id,mode,status) values(c.id,'automatic','cleaning') on conflict(activity_id) do nothing;
  select * into q from private.activity_data_cleanup where activity_id=c.id for update;
  if q.lease_until>clock_timestamp() then continue;end if;
  if end_at<=clock_timestamp() and q.mode='manual' then update private.activity_data_cleanup set mode='automatic',status='cleaning',consecutive_empty_checks=0,next_attempt_at=clock_timestamp() where activity_id=c.id;select * into q from private.activity_data_cleanup where activity_id=c.id;end if;
  if q.status='completed' or q.next_attempt_at>clock_timestamp() or q.last_round_slot>=round_slot then continue;end if;
  update private.activity_data_cleanup set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',last_round_slot=round_slot where activity_id=c.id returning * into q;
  -- Any reappearing data during confirmation invalidates the previous empty round.
  if q.status='verifying' and (exists(select 1 from private.activity_registration_details d join public.applications a on a.id=d.application_id where a.activity_id=c.id) or exists(select 1 from public.application_payment_proofs where activity_id=c.id and (purged_at is null or object_path is not null)) or jsonb_array_length(private.list_activity_cleanup_objects(c.id,q.lease_id,1)->'objectPaths')>0) then
   update private.activity_data_cleanup set status='cleaning',consecutive_empty_checks=0 where activity_id=c.id returning * into q;
  end if;
  delete from private.activity_registration_details where application_id in(select id from public.applications where activity_id=c.id);
  -- Keep current_payment_proof_id and all immutable audit references unchanged.
  update public.application_payment_proofs set object_path=null,purged_at=clock_timestamp() where activity_id=c.id and purged_at is null;
  paths:=private.list_activity_cleanup_objects(c.id,q.lease_id,100);
  jobs:=jobs||jsonb_build_array(jsonb_build_object('activityId',c.id,'leaseId',q.lease_id,'mode',q.mode,'phase',case when q.status='verifying' then 'confirm' else 'clear' end,'verifyNotBefore',case when q.status='verifying' then q.last_checked_at+interval '180 seconds' else null end,'objectPaths',paths->'objectPaths'));
 end loop;
 return jsonb_build_object('jobs',jobs);end;$$;
create function private.finish_activity_data_cleanup(p_activity_id uuid,p_lease_id uuid,p_succeeded boolean,p_error_code text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q private.activity_data_cleanup%rowtype;residue boolean;streak integer;state text;code text;
begin
 perform 1 from public.content_items where id=p_activity_id for update;
 select * into q from private.activity_data_cleanup where activity_id=p_activity_id for update;
 if q.activity_id is null or q.lease_id is distinct from p_lease_id or p_lease_id is null or q.lease_until<=clock_timestamp() then raise exception 'INVALID_CLEANUP_LEASE';end if;
 select exists(select 1 from private.activity_registration_details d join public.applications a on a.id=d.application_id where a.activity_id=p_activity_id) or exists(select 1 from public.application_payment_proofs where activity_id=p_activity_id and (object_path is not null or purged_at is null)) or exists(select 1 from storage.objects o where o.bucket_id='payment-proofs' and exists(select 1 from public.applications a where a.activity_id=p_activity_id and starts_with(o.name,a.user_id::text||'/'||a.id::text||'/'))) into residue;
 code:=case when p_error_code in ('storage_error','timeout','rpc_error','residue','invalid_response','BATCH_LIMIT','STORAGE_DELETE_FAILED','RPC_FAILED','TIMEOUT') then p_error_code when p_error_code is null then null else 'executor_error' end;
 -- A new cron slot may precede the true 180-second verification time. Keep the
 -- lease and streak intact so the bounded executor can wait and retry this finish.
 if p_succeeded is true and not residue and code is null and q.consecutive_empty_checks=1
  and clock_timestamp()<q.last_checked_at+interval '180 seconds' then
  return jsonb_build_object('status',q.status,'consecutiveEmptyChecks',q.consecutive_empty_checks,'nextAttemptAt',q.last_checked_at+interval '180 seconds','leaseRetained',true,
   'retryAfterMs',greatest(1,ceil(extract(epoch from (q.last_checked_at+interval '180 seconds'-clock_timestamp()))*1000))::integer);
 end if;
 streak:=case when p_succeeded is true and not residue and code is null then q.consecutive_empty_checks+1 else 0 end;
 state:=case when streak>=2 then 'completed' when streak=1 then 'verifying' else 'cleaning' end;
 update private.activity_data_cleanup set status=state,consecutive_empty_checks=least(streak,2),lease_id=null,lease_until=null,last_checked_at=clock_timestamp(),next_attempt_at=to_timestamp((floor(extract(epoch from clock_timestamp())/180)+1)*180),cleared_at=case when state='completed' then clock_timestamp() else cleared_at end,error_code=case when residue then 'residue' else code end where activity_id=p_activity_id returning * into q;
 perform private.insurance_audit(p_activity_id,'cleanup_checked',jsonb_build_object('status',state,'consecutiveEmptyChecks',q.consecutive_empty_checks,'errorCode',q.error_code));
 return jsonb_build_object('status',state,'consecutiveEmptyChecks',q.consecutive_empty_checks,'nextAttemptAt',case when state='completed' then null else q.next_attempt_at end);end;$$;
-- A row lock makes late uploads serialize with the cleanup seal.
create function private.guard_payment_object_retention() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare activity uuid;
begin
 if new.bucket_id<>'payment-proofs' then return new;end if;
 select activity_id into activity from public.applications where id::text=split_part(new.name,'/',2) and user_id::text=split_part(new.name,'/',1);
 if activity is null then raise exception 'INVALID_PROOF_PATH';end if;
 perform 1 from public.content_items where id=activity for update;
 if not private.activity_sensitive_open(activity) then raise exception 'ACTIVITY_DATA_CLOSED';end if;
 return new;end;$$;
create trigger guard_payment_object_retention before insert or update on storage.objects for each row execute function private.guard_payment_object_retention();
create function private.payment_object_read_open(p_name text) returns boolean language sql security definer set search_path=pg_catalog,public set row_security=off as $$
 select auth.uid() is not null and coalesce(auth.jwt()->>'is_anonymous','false')<>'true' and exists(select 1 from public.applications a where a.id::text=split_part(p_name,'/',2) and a.user_id::text=split_part(p_name,'/',1) and (a.user_id=auth.uid() or auth.jwt()#>>'{app_metadata,role}'='admin') and private.activity_sensitive_open(a.activity_id))
$$;
revoke all on function private.payment_object_read_open(text) from public,anon,authenticated;
grant execute on function private.payment_object_read_open(text) to anon,authenticated;
create policy payment_proof_retention_read on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'payment-proofs' or private.payment_object_read_open(name));
create policy payment_proof_rows_retention_read on public.application_payment_proofs as restrictive for select to anon,authenticated using(purged_at is null and private.activity_sensitive_open(activity_id));

create or replace function private.registration_state(p_activity_id uuid,p_admin boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set row_security=off set lock_timeout='5s'
as $fn$
declare c public.content_items%rowtype; cap integer; total bigint; apps jsonb; events jsonb; admin boolean;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 admin:=coalesce(auth.jwt()->'app_metadata'->>'role','')='admin';
 if p_admin and not admin then raise exception 'ADMIN_REQUIRED'; end if;
 -- All queue and capacity writers take the same activity row exclusively.
 -- Hold a shared lock through all reads to avoid a mixed count/position snapshot.
 select * into c from public.content_items where id=p_activity_id and kind='activity' for share;
 if not found or (not admin and not c.published and not exists(select 1 from public.applications where activity_id=p_activity_id and user_id=auth.uid())) then raise exception 'ACTIVITY_UNAVAILABLE'; end if;
 cap:=case when jsonb_typeof(c.payload->'registrationCapacity')='number' and (c.payload->>'registrationCapacity')::numeric between 1 and 100000
 and trunc((c.payload->>'registrationCapacity')::numeric)=(c.payload->>'registrationCapacity')::numeric then (c.payload->>'registrationCapacity')::integer else null end;
 select count(*) into total from public.applications where activity_id=p_activity_id and registration_status='active';
 with ranked as (select id,row_number() over(order by registered_at,id) pos from public.applications where activity_id=p_activity_id and registration_status='active')
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'userId',a.user_id,'displayName',coalesce(a.registration_real_name,a.display_name),'email',a.email,
 'createdAt',a.created_at,'registeredAt',a.registered_at,'status',a.registration_status,'paymentStatus',a.payment_status,'currentPaymentProofId',a.current_payment_proof_id,
 'insuranceStatus',a.insurance_status,'detailsUpdatedAt',a.details_updated_at,'detailsComplete',private.activity_sensitive_open(a.activity_id) and exists(select 1 from private.activity_registration_details d where d.application_id=a.id),'proofsPurgedAt',(select max(p.purged_at) from public.application_payment_proofs p where p.id=a.current_payment_proof_id),'paymentProofs',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'objectPath',p.object_path,'submittedAt',p.submitted_at) order by p.submitted_at desc,p.id desc),'[]'::jsonb) from public.application_payment_proofs p where p.application_id=a.id and p.purged_at is null and private.activity_sensitive_open(a.activity_id)),'position',r.pos,
 'selectionStatus',case when a.registration_status='withdrawn' then 'withdrawn' when cap is null then 'unconfirmed' when r.pos<=cap then 'confirmed' else 'waitlisted' end)
 order by a.registered_at,a.id),'[]'::jsonb) into apps
 from public.applications a left join ranked r on r.id=a.id where a.activity_id=p_activity_id and (p_admin or a.user_id=auth.uid());

 return jsonb_build_object('retention',private.retention_state(p_activity_id),'paymentQrUrl',(select wechat_qr_url from public.payment_settings where singleton),'capacity',cap,'activeCount',total,'confirmedCount',case when cap is null then 0 else least(total,cap) end,
 'waitlistCount',case when cap is null then 0 else greatest(total-cap,0) end)
 ||case when p_admin then jsonb_build_object('viewerId',auth.uid(),'applications',apps)
 else jsonb_build_object('application',apps->0,'canSubmitPaymentProof',private.can_submit_application_payment_proof((apps#>>'{0,id}')::uuid),'canWithdraw',coalesce(apps#>>'{0,status}'='active' and clock_timestamp()<public.activity_iso_time(c.payload->>'dateStart'),false)) end;
end;$fn$;
create or replace function private.can_submit_application_payment_proof(p_application_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public set row_security=off
as $fn$
declare a public.applications%rowtype; c public.content_items%rowtype; cap integer; pos bigint;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then return false; end if;
 select * into a from public.applications where id=p_application_id and user_id=auth.uid();
 if not private.activity_sensitive_open(a.activity_id) then return false;end if;
 if not found or a.registration_status<>'active' or a.payment_status<>'unpaid' then return false; end if;
 select * into c from public.content_items where id=a.activity_id and kind='activity';
 if not found or not c.published or c.payload->>'isDemo'='true' or c.payload->>'archived'='true' then return false; end if;
 cap:=case when jsonb_typeof(c.payload->'registrationCapacity')='number' and (c.payload->>'registrationCapacity')::numeric between 1 and 100000
 and trunc((c.payload->>'registrationCapacity')::numeric)=(c.payload->>'registrationCapacity')::numeric then (c.payload->>'registrationCapacity')::integer else null end;
 if cap is null then return false; end if;
 select count(*) into pos from public.applications where activity_id=a.activity_id and registration_status='active' and (registered_at,id)<=(a.registered_at,a.id);
 return pos between 1 and cap;
end;$fn$;
create or replace function private.submit_activity_payment_proof(p_activity_id uuid,p_object_path text,p_expected_user_id uuid,p_expected_payment_status text,p_expected_proof_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set row_security=off set lock_timeout='5s'
as $fn$
declare c public.content_items%rowtype; a public.applications%rowtype; existing public.application_payment_proofs%rowtype; object storage.objects%rowtype; proof_id uuid;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 if p_expected_user_id is null or p_expected_user_id is distinct from auth.uid() then raise exception 'AUTH_CHANGED'; end if;
 select * into c from public.content_items where id=p_activity_id and kind='activity' for update;
 if not found then raise exception 'ACTIVITY_UNAVAILABLE'; end if;
 if not private.activity_sensitive_open(p_activity_id) then raise exception 'ACTIVITY_DATA_CLOSED';end if;
 select * into a from public.applications where activity_id=p_activity_id and user_id=auth.uid() for update;
 if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
 if p_object_path is null or p_object_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
 or split_part(p_object_path,'/',1)<>auth.uid()::text or split_part(p_object_path,'/',2)<>a.id::text then raise exception 'INVALID_PROOF_PATH'; end if;
 select * into existing from public.application_payment_proofs where object_path=p_object_path;
 if found then
  if existing.application_id=a.id and existing.user_id=auth.uid() and existing.id=a.current_payment_proof_id then return private.registration_state(p_activity_id); end if;
  raise exception 'STALE_PAYMENT_PROOF';
 end if;
 if p_expected_payment_status is null or p_expected_payment_status not in ('unpaid','pending','paid') then raise exception 'INVALID_PAYMENT_STATUS'; end if;
 if a.payment_status is distinct from p_expected_payment_status or a.current_payment_proof_id is distinct from p_expected_proof_id then raise exception 'STALE_PAYMENT_STATUS_OR_PROOF'; end if;
 if not private.can_submit_application_payment_proof(a.id) then raise exception 'PROOF_SUBMISSION_NOT_ELIGIBLE'; end if;
 select * into object from storage.objects where bucket_id='payment-proofs' and name=p_object_path for share;
 if not found or coalesce(object.owner_id,object.owner::text) is distinct from auth.uid()::text then raise exception 'PAYMENT_PROOF_OBJECT_REQUIRED'; end if;
 if object.metadata->>'mimetype' is distinct from 'image/webp' or jsonb_typeof(object.metadata->'size') is distinct from 'number' then raise exception 'INVALID_PROOF_METADATA'; end if;
 if (object.metadata->>'size')::numeric<=0 or (object.metadata->>'size')::numeric>1048576 or trunc((object.metadata->>'size')::numeric)<>(object.metadata->>'size')::numeric then raise exception 'INVALID_PROOF_METADATA'; end if;
 insert into public.application_payment_proofs(application_id,activity_id,user_id,object_path) values(a.id,a.activity_id,auth.uid(),p_object_path) returning id into proof_id;
 update public.applications set current_payment_proof_id=proof_id,payment_status='pending' where id=a.id;
 return private.registration_state(p_activity_id);
end;$fn$;
grant usage on schema private to service_role;
create function public.get_member_profile() returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.get_member_profile()$$;
revoke all on function public.get_member_profile() from public,anon,authenticated;
grant execute on function public.get_member_profile() to authenticated;
revoke all on function private.get_member_profile() from public,anon,authenticated;
grant execute on function private.get_member_profile() to authenticated;
create function public.save_member_profile(p_username text,p_real_name text,p_phone text,p_expected_updated_at timestamptz,p_expected_user_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.save_member_profile(p_username,p_real_name,p_phone,p_expected_updated_at,p_expected_user_id)$$;
revoke all on function public.save_member_profile(text,text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.save_member_profile(text,text,text,timestamptz,uuid) to authenticated;
revoke all on function private.save_member_profile(text,text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function private.save_member_profile(text,text,text,timestamptz,uuid) to authenticated;
create function public.get_member_activity_history() returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.get_member_activity_history()$$;
revoke all on function public.get_member_activity_history() from public,anon,authenticated;
grant execute on function public.get_member_activity_history() to authenticated;
revoke all on function private.get_member_activity_history() from public,anon,authenticated;
grant execute on function private.get_member_activity_history() to authenticated;
create function public.register_activity(p_activity_id uuid,p_expected_user_id uuid,p_real_name text,p_id_number text,p_phone text,p_consent boolean) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.register_activity(p_activity_id,p_expected_user_id,p_real_name,p_id_number,p_phone,p_consent)$$;
revoke all on function public.register_activity(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.register_activity(uuid,uuid,text,text,text,boolean) to authenticated;
revoke all on function private.register_activity(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function private.register_activity(uuid,uuid,text,text,text,boolean) to authenticated;
create function public.save_activity_registration_details(p_activity_id uuid,p_expected_user_id uuid,p_real_name text,p_id_number text,p_phone text,p_consent boolean) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.save_activity_registration_details(p_activity_id,p_expected_user_id,p_real_name,p_id_number,p_phone,p_consent)$$;
revoke all on function public.save_activity_registration_details(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.save_activity_registration_details(uuid,uuid,text,text,text,boolean) to authenticated;
revoke all on function private.save_activity_registration_details(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function private.save_activity_registration_details(uuid,uuid,text,text,text,boolean) to authenticated;
create function public.set_activity_registration_insurance(p_application_id uuid,p_insurance_status text,p_expected_insurance_status text,p_expected_user_id uuid,p_expected_details_updated_at timestamptz) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.set_activity_registration_insurance(p_application_id,p_insurance_status,p_expected_insurance_status,p_expected_user_id,p_expected_details_updated_at)$$;
revoke all on function public.set_activity_registration_insurance(uuid,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.set_activity_registration_insurance(uuid,text,text,uuid,timestamptz) to authenticated;
revoke all on function private.set_activity_registration_insurance(uuid,text,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.set_activity_registration_insurance(uuid,text,text,uuid,timestamptz) to authenticated;
create function public.export_activity_insurance(p_activity_id uuid,p_expected_user_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.export_activity_insurance(p_activity_id,p_expected_user_id)$$;
revoke all on function public.export_activity_insurance(uuid,uuid) from public,anon,authenticated;
grant execute on function public.export_activity_insurance(uuid,uuid) to authenticated;
revoke all on function private.export_activity_insurance(uuid,uuid) from public,anon,authenticated;
grant execute on function private.export_activity_insurance(uuid,uuid) to authenticated;
create function public.prepare_activity_data_cleanup(p_activity_id uuid,p_expected_user_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.prepare_activity_data_cleanup(p_activity_id,p_expected_user_id)$$;
revoke all on function public.prepare_activity_data_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_activity_data_cleanup(uuid,uuid) to authenticated;
revoke all on function private.prepare_activity_data_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function private.prepare_activity_data_cleanup(uuid,uuid) to authenticated;
create function public.confirm_activity_data_cleanup(p_confirmation_id uuid,p_expected_user_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.confirm_activity_data_cleanup(p_confirmation_id,p_expected_user_id)$$;
revoke all on function public.confirm_activity_data_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_activity_data_cleanup(uuid,uuid) to authenticated;
revoke all on function private.confirm_activity_data_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function private.confirm_activity_data_cleanup(uuid,uuid) to authenticated;
create function public.execute_activity_data_cleanup(p_confirmation_id uuid,p_expected_user_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.execute_activity_data_cleanup(p_confirmation_id,p_expected_user_id)$$;
revoke all on function public.execute_activity_data_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.execute_activity_data_cleanup(uuid,uuid) to authenticated;
revoke all on function private.execute_activity_data_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function private.execute_activity_data_cleanup(uuid,uuid) to authenticated;
create function public.claim_activity_data_cleanup(p_limit integer) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.claim_activity_data_cleanup(p_limit)$$;
revoke all on function public.claim_activity_data_cleanup(integer) from public,anon,authenticated;
grant execute on function public.claim_activity_data_cleanup(integer) to service_role;
revoke all on function private.claim_activity_data_cleanup(integer) from public,anon,authenticated;
grant execute on function private.claim_activity_data_cleanup(integer) to service_role;
create function public.list_activity_cleanup_objects(p_activity_id uuid,p_lease_id uuid,p_limit integer) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.list_activity_cleanup_objects(p_activity_id,p_lease_id,p_limit)$$;
revoke all on function public.list_activity_cleanup_objects(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_activity_cleanup_objects(uuid,uuid,integer) to service_role;
revoke all on function private.list_activity_cleanup_objects(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function private.list_activity_cleanup_objects(uuid,uuid,integer) to service_role;
create function public.finish_activity_data_cleanup(p_activity_id uuid,p_lease_id uuid,p_succeeded boolean,p_error_code text) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.finish_activity_data_cleanup(p_activity_id,p_lease_id,p_succeeded,p_error_code)$$;
revoke all on function public.finish_activity_data_cleanup(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_activity_data_cleanup(uuid,uuid,boolean,text) to service_role;
revoke all on function private.finish_activity_data_cleanup(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function private.finish_activity_data_cleanup(uuid,uuid,boolean,text) to service_role;
revoke all on function private.member_identity(uuid,boolean) from public,anon,authenticated;
revoke all on function private.retention_state(uuid) from public,anon,authenticated;
revoke all on function private.validate_insurance_details(text,text,text,boolean) from public,anon,authenticated;
revoke all on function private.insurance_audit(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function private.guard_payment_object_retention() from public,anon,authenticated;
revoke all on function private.activity_sensitive_open(uuid) from public,anon,authenticated;
grant execute on function private.activity_sensitive_open(uuid) to authenticated;
commit;
