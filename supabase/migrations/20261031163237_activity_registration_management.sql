begin;
-- No legacy payload, timestamp, identity or chuanheng record is rewritten.
alter table public.applications add column registration_status text not null default 'active' check(registration_status in ('active','withdrawn')),
 add column payment_status text not null default 'unpaid' check(payment_status in ('paid','unpaid')),
 add column registered_at timestamptz,
 add column display_name text,
 add column email text;
update public.applications set registered_at=created_at;
-- One-time display-only snapshot for existing registrations, before audit
-- triggers exist. Do not rewrite their payload/identity/creation time or grant
-- any auth.users access to clients. User metadata never determines authority.
update public.applications a set
 display_name=left(coalesce(nullif(u.raw_user_meta_data->>'displayName',''),
 nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),u.id::text),200),
 email=left(u.email,320)
from auth.users u where u.id=a.user_id;
alter table public.applications alter column registered_at set not null;
create index applications_activity_queue_idx on public.applications(activity_id,registered_at,id) where registration_status='active';
-- No client DML: even administrators use the expected-old-value payment RPC.
revoke insert,update,delete,truncate,references,trigger on public.applications from public,anon,authenticated;
drop policy applications_owner_insert on public.applications;
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;

create table public.registration_events(
 id bigint generated always as identity primary key,
 -- Keep the activity UUID/title after deletion; applications still protect actual registrations.
 activity_id uuid not null,
 action text not null check(action in ('registered','withdrawn','rejoined','payment_changed','capacity_changed')),
 actor_id uuid not null,
 actor_label text not null,
 actor_type text not null check(actor_type in ('member','admin','system')),
 source text not null check(source in ('self_service','manual','automatic')),
 subject_user_id uuid,
 subject_label text,
 occurred_at timestamptz not null default clock_timestamp(),
 details jsonb not null check(jsonb_typeof(details)='object')
);
create index registration_events_activity_idx on public.registration_events(activity_id,occurred_at desc,id desc);
alter table public.registration_events enable row level security;
alter table public.registration_events force row level security;
revoke all on public.registration_events from public,anon,authenticated;
grant select on public.registration_events to authenticated;
create policy registration_events_admin_read on public.registration_events for select to authenticated
 using(auth.uid() is not null and auth.jwt()->'app_metadata'->>'role'='admin');

-- Small read-only cross-RLS helper: cannot accept a subject UUID. It returns
-- only auth.uid()'s identity plus anonymous counts unless trusted admin claim.
-- private is not an API-exposed schema. Direct SQL calls enforce identical checks.
create function private.registration_state(p_activity_id uuid,p_admin boolean default false) returns jsonb
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
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'userId',a.user_id,'displayName',a.display_name,'email',a.email,
 'createdAt',a.created_at,'registeredAt',a.registered_at,'status',a.registration_status,'paymentStatus',a.payment_status,'position',r.pos,
 'selectionStatus',case when a.registration_status='withdrawn' then 'withdrawn' when cap is null then 'unconfirmed' when r.pos<=cap then 'confirmed' else 'waitlisted' end)
 order by a.registered_at,a.id),'[]'::jsonb) into apps
 from public.applications a left join ranked r on r.id=a.id where a.activity_id=p_activity_id and (p_admin or a.user_id=auth.uid());
 if p_admin then
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actorId',e.actor_id,'actorLabel',e.actor_label,'actorType',e.actor_type,'source',e.source,
 'subjectUserId',e.subject_user_id,'subjectLabel',e.subject_label,'occurredAt',e.occurred_at,'details',e.details) order by e.occurred_at desc,e.id desc),'[]'::jsonb)
 into events from public.registration_events e where activity_id=p_activity_id;
 end if;
 return jsonb_build_object('capacity',cap,'activeCount',total,'confirmedCount',case when cap is null then 0 else least(total,cap) end,
 'waitlistCount',case when cap is null then 0 else greatest(total-cap,0) end)
 ||case when p_admin then jsonb_build_object('viewerId',auth.uid(),'applications',apps,'events',events)
 else jsonb_build_object('application',apps->0,'canWithdraw',coalesce(apps#>>'{0,status}'='active' and clock_timestamp()<public.activity_iso_time(c.payload->>'dateStart'),false)) end;
end;$fn$;

-- Writes need narrowly scoped definer helpers because all direct DML is revoked.
-- No dynamic SQL, arbitrary target user, session flag, or automatic-payment entry.
-- Activity row lock serializes registration/rejoin/withdraw/payment with capacity
-- edits. MAX + 1 microsecond ensures rejoin is last even after a clock rollback.
create function private.register_activity(p_activity_id uuid,p_expected_user_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set row_security=off set lock_timeout='5s'
as $fn$
declare c public.content_items%rowtype; a public.applications%rowtype; at_time timestamptz; queue_time timestamptz; cap numeric;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 -- Bind this request to the account confirmed before the client started it.
 if p_expected_user_id is null or p_expected_user_id is distinct from auth.uid() then raise exception 'AUTH_CHANGED'; end if;
 select * into c from public.content_items where id=p_activity_id and kind='activity' for update;
 if not found then raise exception 'ACTIVITY_UNAVAILABLE'; end if;
 select * into a from public.applications where activity_id=p_activity_id and user_id=auth.uid();
 if a.registration_status='active' then return private.registration_state(p_activity_id); end if;
 at_time:=clock_timestamp();
 cap:=case when jsonb_typeof(c.payload->'registrationCapacity')='number' then (c.payload->>'registrationCapacity')::numeric else null end;
 if cap is null or cap<1 or cap>100000 or trunc(cap)<>cap then raise exception 'REGISTRATION_CAPACITY_REQUIRED'; end if;
 if not coalesce(c.published and c.payload->>'isDemo' is distinct from 'true' and c.payload->>'archived' is distinct from 'true'
 and c.payload->>'status' is distinct from '已结束' and c.payload->>'registrationOpen'='true'
 and public.activity_iso_time(c.payload->>'registrationStart')<=at_time
 and at_time<public.activity_iso_time(c.payload->>'registrationDeadline')
 and at_time<public.activity_iso_time(c.payload->>'dateStart') and at_time<public.activity_iso_time(c.payload->>'dateEnd')
 and public.activity_iso_time(c.payload->>'registrationStart')<public.activity_iso_time(c.payload->>'registrationDeadline')
 and public.activity_iso_time(c.payload->>'registrationDeadline')<=public.activity_iso_time(c.payload->>'dateStart')
 and public.activity_iso_time(c.payload->>'dateStart')<public.activity_iso_time(c.payload->>'dateEnd'),false) then raise exception 'REGISTRATION_CLOSED'; end if;
 select greatest(at_time,coalesce(max(registered_at)+interval '1 microsecond',at_time)) into queue_time from public.applications where activity_id=p_activity_id;
 if a.id is null then
 insert into public.applications(activity_id,user_id,created_at,registered_at,display_name,email)
 values(p_activity_id,auth.uid(),at_time,queue_time,
 left(coalesce(nullif(auth.jwt()#>>'{user_metadata,displayName}',''),nullif(auth.jwt()#>>'{user_metadata,full_name}',''),auth.jwt()->>'email',auth.uid()::text),200),left(auth.jwt()->>'email',320));
 else
 update public.applications set registration_status='active',registered_at=queue_time where id=a.id;
 end if;
 return private.registration_state(p_activity_id);
end;$fn$;
create function private.withdraw_activity_registration(p_activity_id uuid,p_expected_user_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set row_security=off set lock_timeout='5s'
as $fn$
declare c public.content_items%rowtype; a public.applications%rowtype;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 -- Bind this request to the account confirmed before the client started it.
 if p_expected_user_id is null or p_expected_user_id is distinct from auth.uid() then raise exception 'AUTH_CHANGED'; end if;
 select * into c from public.content_items where id=p_activity_id and kind='activity' for update;
 if not found then raise exception 'ACTIVITY_UNAVAILABLE'; end if;
 select * into a from public.applications where activity_id=p_activity_id and user_id=auth.uid();
 if a.id is null or a.registration_status='withdrawn' then return private.registration_state(p_activity_id); end if;
 if not coalesce(clock_timestamp()<public.activity_iso_time(c.payload->>'dateStart'),false) then raise exception 'WITHDRAWAL_CLOSED'; end if;
 update public.applications set registration_status='withdrawn' where id=a.id;
 return private.registration_state(p_activity_id);
end;$fn$;
create function private.set_activity_registration_payment(p_application_id uuid,p_payment_status text,p_expected_payment_status text,p_expected_user_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set row_security=off set lock_timeout='5s'
as $fn$
declare activity uuid; a public.applications%rowtype;
begin
 if auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'ADMIN_REQUIRED'; end if;
 -- Bind this request to the account confirmed before the client started it.
 if p_expected_user_id is null or p_expected_user_id is distinct from auth.uid() then raise exception 'AUTH_CHANGED'; end if;
 if p_payment_status is null or p_payment_status not in ('paid','unpaid') or p_expected_payment_status is null or p_expected_payment_status not in ('paid','unpaid') then raise exception 'INVALID_PAYMENT_STATUS'; end if;
 select activity_id into activity from public.applications where id=p_application_id;
 if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
 perform 1 from public.content_items where id=activity for update;
 select * into a from public.applications where id=p_application_id for update;
 if a.payment_status<>p_expected_payment_status then raise exception 'STALE_PAYMENT_STATUS'; end if;
 if a.payment_status<>p_payment_status then update public.applications set payment_status=p_payment_status where id=a.id; end if;
 return private.registration_state(activity,true);
end;$fn$;

-- Only trigger execution can append history. Metadata supplies a display label,
-- never authority: actor UUID is auth.uid(), role is trusted app_metadata only.
create function private.audit_registration() returns trigger
language plpgsql security definer set search_path=pg_catalog,public set row_security=off
as $fn$
declare action_name text; changes jsonb; source_name text; actor_admin boolean;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 actor_admin:=coalesce(auth.jwt()->'app_metadata'->>'role','')='admin';
 if tg_op='INSERT' then action_name:='registered';changes:=jsonb_build_object('status',jsonb_build_object('before',null,'after',new.registration_status),'registeredAt',new.registered_at);source_name:='self_service';
 elsif new.registration_status is distinct from old.registration_status then
 action_name:=case new.registration_status when 'withdrawn' then 'withdrawn' else 'rejoined' end;
 changes:=jsonb_build_object('status',jsonb_build_object('before',old.registration_status,'after',new.registration_status),'registeredAt',jsonb_build_object('before',old.registered_at,'after',new.registered_at));source_name:='self_service';
 elsif new.payment_status is distinct from old.payment_status then
 if not actor_admin then raise exception 'ADMIN_REQUIRED'; end if;
 action_name:='payment_changed';changes:=jsonb_build_object('paymentStatus',jsonb_build_object('before',old.payment_status,'after',new.payment_status));source_name:='manual';
 else return null; end if;
 insert into public.registration_events(activity_id,action,actor_id,actor_label,actor_type,source,subject_user_id,subject_label,details)
 values(new.activity_id,action_name,auth.uid(),left(coalesce(nullif(auth.jwt()#>>'{user_metadata,displayName}',''),nullif(auth.jwt()#>>'{user_metadata,full_name}',''),auth.jwt()->>'email',auth.uid()::text),200),
 case when actor_admin then 'admin' else 'member' end,source_name,new.user_id,new.display_name,changes || jsonb_build_object('activityTitle',(select payload->>'title' from public.content_items where id=new.activity_id)));
 return null;
end;$fn$;
create trigger audit_registration after insert or update on public.applications for each row execute function private.audit_registration();

create function private.guard_registration_capacity() returns trigger
language plpgsql security definer set search_path=pg_catalog,public set row_security=off
as $fn$
declare previous jsonb; cap jsonb; changed boolean; opening boolean;
begin
 if new.kind<>'activity' then return null; end if;
 if tg_op='UPDATE' then previous:=old.payload->'registrationCapacity'; end if;
 cap:=new.payload->'registrationCapacity';changed:=cap is distinct from previous;
 opening:=new.payload->>'registrationOpen'='true' and (tg_op='INSERT' or old.payload->>'registrationOpen' is distinct from 'true');
 if changed or opening then
 if cap is not null and cap<>'null'::jsonb then
 if jsonb_typeof(cap)<>'number' then raise exception 'INVALID_REGISTRATION_CAPACITY'; end if;
 if (cap::text)::numeric<1 or (cap::text)::numeric>100000 or trunc((cap::text)::numeric)<>(cap::text)::numeric then raise exception 'INVALID_REGISTRATION_CAPACITY'; end if;
 elsif opening or (changed and new.payload->>'registrationOpen'='true') then raise exception 'REGISTRATION_CAPACITY_REQUIRED'; end if;
 end if;
 if changed then
 if auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'ADMIN_REQUIRED'; end if;
 insert into public.registration_events(activity_id,action,actor_id,actor_label,actor_type,source,details)
 values(new.id,'capacity_changed',auth.uid(),left(coalesce(nullif(auth.jwt()#>>'{user_metadata,displayName}',''),nullif(auth.jwt()#>>'{user_metadata,full_name}',''),auth.jwt()->>'email',auth.uid()::text),200),'admin','manual',jsonb_build_object('activityTitle',new.payload->>'title','capacity',jsonb_build_object('before',previous,'after',cap)));
 end if;
 return null;
end;$fn$;
create trigger guard_registration_capacity after insert or update on public.content_items for each row execute function private.guard_registration_capacity();

create function public.get_activity_registration(p_activity_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.registration_state(p_activity_id,false)$$;
create function public.get_activity_registrations(p_activity_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.registration_state(p_activity_id,true)$$;
create function public.register_activity(p_activity_id uuid,p_expected_user_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.register_activity(p_activity_id,p_expected_user_id)$$;
create function public.withdraw_activity_registration(p_activity_id uuid,p_expected_user_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.withdraw_activity_registration(p_activity_id,p_expected_user_id)$$;
create function public.set_activity_registration_payment(p_application_id uuid,p_payment_status text,p_expected_payment_status text,p_expected_user_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.set_activity_registration_payment(p_application_id,p_payment_status,p_expected_payment_status,p_expected_user_id)$$;
revoke all on function private.registration_state(uuid,boolean),private.register_activity(uuid,uuid),private.withdraw_activity_registration(uuid,uuid),private.set_activity_registration_payment(uuid,text,text,uuid),private.audit_registration(),private.guard_registration_capacity() from public,anon,authenticated;
grant execute on function private.registration_state(uuid,boolean),private.register_activity(uuid,uuid),private.withdraw_activity_registration(uuid,uuid),private.set_activity_registration_payment(uuid,text,text,uuid) to authenticated;
revoke all on function public.get_activity_registration(uuid),public.get_activity_registrations(uuid),public.register_activity(uuid,uuid),public.withdraw_activity_registration(uuid,uuid),public.set_activity_registration_payment(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.get_activity_registration(uuid),public.get_activity_registrations(uuid),public.register_activity(uuid,uuid),public.withdraw_activity_registration(uuid,uuid),public.set_activity_registration_payment(uuid,text,text,uuid) to authenticated;
commit;
