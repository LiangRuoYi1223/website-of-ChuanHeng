begin;
-- Additive receipt workflow: no legacy content, original application fields or
-- historical audit events are rewritten. 'pending' is a member claim, not payment verification.
alter table public.applications drop constraint applications_payment_status_check;
alter table public.applications add constraint applications_payment_status_check check(payment_status in ('unpaid','pending','paid'));
alter table public.registration_events drop constraint registration_events_action_check;
alter table public.registration_events add constraint registration_events_action_check check(action in ('registered','withdrawn','rejoined','payment_changed','capacity_changed','payment_proof_submitted'));

create table public.application_payment_proofs(
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.applications(id),
 activity_id uuid not null references public.content_items(id),
 user_id uuid not null references auth.users(id),
 object_path text not null unique,
 submitted_at timestamptz not null default clock_timestamp(),
 constraint application_payment_proofs_path_check check(object_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')
);
create index application_payment_proofs_application_latest_idx on public.application_payment_proofs(application_id,submitted_at desc,id desc);
create index application_payment_proofs_activity_idx on public.application_payment_proofs(activity_id);
create index application_payment_proofs_user_idx on public.application_payment_proofs(user_id);
alter table public.applications add column current_payment_proof_id uuid references public.application_payment_proofs(id);
create index applications_current_payment_proof_idx on public.applications(current_payment_proof_id) where current_payment_proof_id is not null;
alter table public.application_payment_proofs enable row level security;
alter table public.application_payment_proofs force row level security;
revoke all on public.application_payment_proofs from public,anon,authenticated;
grant select on public.application_payment_proofs to authenticated;
create policy application_payment_proofs_owner_admin_read on public.application_payment_proofs for select to authenticated
 using((select auth.uid()) is not null and coalesce((select auth.jwt())->>'is_anonymous','false')<>'true'
 and (user_id=(select auth.uid()) or (select auth.jwt())->'app_metadata'->>'role'='admin'));

-- One global collection code. Members only receive the current URL through
-- registration_state; administrators use bound, optimistic-concurrency RPCs.
create table public.payment_settings(
 singleton boolean primary key default true check(singleton),
 wechat_qr_url text,
 updated_at timestamptz,
 updated_by uuid
);
insert into public.payment_settings(singleton) values(true);
alter table public.payment_settings enable row level security;
alter table public.payment_settings force row level security;
revoke all on public.payment_settings from public,anon,authenticated;
grant select on public.payment_settings to authenticated;
create policy payment_settings_admin_read on public.payment_settings for select to authenticated
 using((select auth.uid()) is not null and coalesce((select auth.jwt())->>'is_anonymous','false')<>'true' and (select auth.jwt())->'app_metadata'->>'role'='admin');
create table public.payment_settings_events(
 id bigint generated always as identity primary key,
 actor_id uuid not null,
 actor_label text not null,
 before_url text,
 after_url text,
 occurred_at timestamptz not null default clock_timestamp(),
 source text not null default 'manual' check(source='manual')
);
create index payment_settings_events_time_idx on public.payment_settings_events(occurred_at desc,id desc);
alter table public.payment_settings_events enable row level security;
alter table public.payment_settings_events force row level security;
revoke all on public.payment_settings_events from public,anon,authenticated;
grant select on public.payment_settings_events to authenticated;
create policy payment_settings_events_admin_read on public.payment_settings_events for select to authenticated
 using((select auth.uid()) is not null and coalesce((select auth.jwt())->>'is_anonymous','false')<>'true' and (select auth.jwt())->'app_metadata'->>'role'='admin');

create function private.audit_payment_settings() returns trigger
language plpgsql security definer set search_path=pg_catalog,public set row_security=off
as $fn$
begin
 if new.wechat_qr_url is not distinct from old.wechat_qr_url then return null; end if;
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'ADMIN_REQUIRED'; end if;
 insert into public.payment_settings_events(actor_id,actor_label,before_url,after_url)
 values(auth.uid(),left(coalesce(nullif(auth.jwt()#>>'{user_metadata,displayName}',''),nullif(auth.jwt()#>>'{user_metadata,full_name}',''),auth.jwt()->>'email',auth.uid()::text),200),old.wechat_qr_url,new.wechat_qr_url);
 return null;
end;$fn$;
create trigger audit_payment_settings after update on public.payment_settings for each row execute function private.audit_payment_settings();

create function private.get_payment_settings() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set row_security=off set lock_timeout='5s'
as $fn$
declare settings public.payment_settings%rowtype;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'ADMIN_REQUIRED'; end if;
 select * into settings from public.payment_settings where singleton for share;
 if not found then raise exception 'PAYMENT_SETTINGS_UNAVAILABLE'; end if;
 return jsonb_build_object('wechatQrUrl',settings.wechat_qr_url,'updatedAt',settings.updated_at,'updatedBy',settings.updated_by);
end;$fn$;

create function private.save_payment_settings(p_wechat_qr_url text,p_expected_updated_at timestamptz,p_expected_user_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set row_security=off set lock_timeout='5s'
as $fn$
declare settings public.payment_settings%rowtype; normalized_url text; object_name text; object storage.objects%rowtype; changed_at timestamptz;
 trusted_prefix constant text:='https://gftecgpbhiubrkmazlcu.supabase.co/storage/v1/object/public/activity-covers/';
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 if coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'ADMIN_REQUIRED'; end if;
 if p_expected_user_id is null or p_expected_user_id is distinct from auth.uid() then raise exception 'AUTH_CHANGED'; end if;
 select * into settings from public.payment_settings where singleton for update;
 if not found then raise exception 'PAYMENT_SETTINGS_UNAVAILABLE'; end if;
 if settings.updated_at is distinct from p_expected_updated_at then raise exception 'STALE_PAYMENT_SETTINGS'; end if;
 normalized_url:=nullif(btrim(coalesce(p_wechat_qr_url,'')),'');
 if normalized_url is not null then
  if length(normalized_url)>2048 or left(normalized_url,length(trusted_prefix))<>trusted_prefix then raise exception 'INVALID_PAYMENT_QR_URL'; end if;
  object_name:=substr(normalized_url,length(trusted_prefix)+1);
  if object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$' then raise exception 'INVALID_PAYMENT_QR_URL'; end if;
  select * into object from storage.objects where bucket_id='activity-covers' and name=object_name for share;
  if not found then raise exception 'PAYMENT_QR_OBJECT_REQUIRED'; end if;
  if object.metadata->>'mimetype' is distinct from 'image/webp' or jsonb_typeof(object.metadata->'size') is distinct from 'number' then raise exception 'INVALID_PAYMENT_QR_METADATA'; end if;
  if (object.metadata->>'size')::numeric<=0 or (object.metadata->>'size')::numeric>3145728 or trunc((object.metadata->>'size')::numeric)<>(object.metadata->>'size')::numeric then raise exception 'INVALID_PAYMENT_QR_METADATA'; end if;
 end if;
 if settings.wechat_qr_url is not distinct from normalized_url then return private.get_payment_settings(); end if;
 changed_at:=greatest(clock_timestamp(),coalesce(settings.updated_at+interval '1 microsecond',clock_timestamp()));
 update public.payment_settings set wechat_qr_url=normalized_url,updated_at=changed_at,updated_by=auth.uid() where singleton;
 return private.get_payment_settings();
end;$fn$;

-- Read-only eligibility helper; no arbitrary subject or privilege/session switches.
create function private.can_submit_application_payment_proof(p_application_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public set row_security=off
as $fn$
declare a public.applications%rowtype; c public.content_items%rowtype; cap integer; pos bigint;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then return false; end if;
 select * into a from public.applications where id=p_application_id and user_id=auth.uid();
 if not found or a.registration_status<>'active' or a.payment_status<>'unpaid' then return false; end if;
 select * into c from public.content_items where id=a.activity_id and kind='activity';
 if not found or not c.published or c.payload->>'isDemo'='true' or c.payload->>'archived'='true' then return false; end if;
 cap:=case when jsonb_typeof(c.payload->'registrationCapacity')='number' and (c.payload->>'registrationCapacity')::numeric between 1 and 100000
 and trunc((c.payload->>'registrationCapacity')::numeric)=(c.payload->>'registrationCapacity')::numeric then (c.payload->>'registrationCapacity')::integer else null end;
 if cap is null then return false; end if;
 select count(*) into pos from public.applications where activity_id=a.activity_id and registration_status='active' and (registered_at,id)<=(a.registered_at,a.id);
 return pos between 1 and cap;
end;$fn$;

create function private.can_insert_payment_proof_object(p_name text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public set row_security=off
as $fn$
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' or p_name is null then return false; end if;
 if p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$' or split_part(p_name,'/',1)<>auth.uid()::text then return false; end if;
 return private.can_submit_application_payment_proof(split_part(p_name,'/',2)::uuid);
end;$fn$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-proofs','payment-proofs',false,3145728,array['image/webp']);
create policy payment_proofs_member_insert on storage.objects for insert to authenticated
with check(bucket_id='payment-proofs' and coalesce(owner_id,owner::text)=(select auth.uid())::text and private.can_insert_payment_proof_object(name));
create policy payment_proofs_owner_admin_read on storage.objects for select to authenticated
using(bucket_id='payment-proofs' and (select auth.uid()) is not null and coalesce((select auth.jwt())->>'is_anonymous','false')<>'true'
 and ((storage.foldername(name))[1]=(select auth.uid())::text or (select auth.jwt())->'app_metadata'->>'role'='admin'));
-- Restrictive guards survive unrelated permissive legacy policies. No overwrite/delete.
create policy payment_proofs_guard_insert on storage.objects as restrictive for insert to anon,authenticated
with check(bucket_id<>'payment-proofs' or (coalesce(owner_id,owner::text)=(select auth.uid())::text and private.can_insert_payment_proof_object(name)));
create policy payment_proofs_guard_select on storage.objects as restrictive for select to anon,authenticated
using(bucket_id<>'payment-proofs' or ((select auth.uid()) is not null and coalesce((select auth.jwt())->>'is_anonymous','false')<>'true'
 and ((storage.foldername(name))[1]=(select auth.uid())::text or (select auth.jwt())->'app_metadata'->>'role'='admin')));
create policy payment_proofs_guard_update on storage.objects as restrictive for update to anon,authenticated
using(bucket_id<>'payment-proofs') with check(bucket_id<>'payment-proofs');
create policy payment_proofs_guard_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'payment-proofs');

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
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'userId',a.user_id,'displayName',a.display_name,'email',a.email,
 'createdAt',a.created_at,'registeredAt',a.registered_at,'status',a.registration_status,'paymentStatus',a.payment_status,'currentPaymentProofId',a.current_payment_proof_id,
 'paymentProofs',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'objectPath',p.object_path,'submittedAt',p.submitted_at) order by p.submitted_at desc,p.id desc),'[]'::jsonb) from public.application_payment_proofs p where p.application_id=a.id),'position',r.pos,
 'selectionStatus',case when a.registration_status='withdrawn' then 'withdrawn' when cap is null then 'unconfirmed' when r.pos<=cap then 'confirmed' else 'waitlisted' end)
 order by a.registered_at,a.id),'[]'::jsonb) into apps
 from public.applications a left join ranked r on r.id=a.id where a.activity_id=p_activity_id and (p_admin or a.user_id=auth.uid());
 if p_admin then
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actorId',e.actor_id,'actorLabel',e.actor_label,'actorType',e.actor_type,'source',e.source,
 'subjectUserId',e.subject_user_id,'subjectLabel',e.subject_label,'occurredAt',e.occurred_at,'details',e.details) order by e.occurred_at desc,e.id desc),'[]'::jsonb)
 into events from public.registration_events e where activity_id=p_activity_id;
 end if;
 return jsonb_build_object('paymentQrUrl',(select wechat_qr_url from public.payment_settings where singleton),'capacity',cap,'activeCount',total,'confirmedCount',case when cap is null then 0 else least(total,cap) end,
 'waitlistCount',case when cap is null then 0 else greatest(total-cap,0) end)
 ||case when p_admin then jsonb_build_object('viewerId',auth.uid(),'applications',apps,'events',events)
 else jsonb_build_object('application',apps->0,'canSubmitPaymentProof',private.can_submit_application_payment_proof((apps#>>'{0,id}')::uuid),'canWithdraw',coalesce(apps#>>'{0,status}'='active' and clock_timestamp()<public.activity_iso_time(c.payload->>'dateStart'),false)) end;
end;$fn$;

create or replace function private.audit_registration() returns trigger
language plpgsql security definer set search_path=pg_catalog,public set row_security=off
as $fn$
declare action_name text; changes jsonb; source_name text; actor_admin boolean; proof public.application_payment_proofs%rowtype;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 actor_admin:=coalesce(auth.jwt()->'app_metadata'->>'role','')='admin';
 if tg_op='INSERT' then action_name:='registered';changes:=jsonb_build_object('status',jsonb_build_object('before',null,'after',new.registration_status),'registeredAt',new.registered_at);source_name:='self_service';
 elsif new.registration_status is distinct from old.registration_status then
 action_name:=case new.registration_status when 'withdrawn' then 'withdrawn' else 'rejoined' end;
 changes:=jsonb_build_object('status',jsonb_build_object('before',old.registration_status,'after',new.registration_status),'registeredAt',jsonb_build_object('before',old.registered_at,'after',new.registered_at));source_name:='self_service';
 elsif new.current_payment_proof_id is distinct from old.current_payment_proof_id then
 if auth.uid() is distinct from new.user_id or old.payment_status<>'unpaid' or new.payment_status<>'pending' then raise exception 'INVALID_PROOF_TRANSITION'; end if;
 select * into proof from public.application_payment_proofs where id=new.current_payment_proof_id and application_id=new.id and user_id=new.user_id and activity_id=new.activity_id;
 if not found then raise exception 'PAYMENT_PROOF_REQUIRED'; end if;
 action_name:='payment_proof_submitted';source_name:='self_service';
 changes:=jsonb_build_object('paymentStatus',jsonb_build_object('before',old.payment_status,'after',new.payment_status),
 'proofId',jsonb_build_object('before',old.current_payment_proof_id,'after',new.current_payment_proof_id),'objectPath',proof.object_path);
 elsif new.payment_status is distinct from old.payment_status then
 if not actor_admin then raise exception 'ADMIN_REQUIRED'; end if;
 action_name:='payment_changed';changes:=jsonb_build_object('paymentStatus',jsonb_build_object('before',old.payment_status,'after',new.payment_status));source_name:='manual';
 else return null; end if;
 insert into public.registration_events(activity_id,action,actor_id,actor_label,actor_type,source,subject_user_id,subject_label,details)
 values(new.activity_id,action_name,auth.uid(),left(coalesce(nullif(auth.jwt()#>>'{user_metadata,displayName}',''),nullif(auth.jwt()#>>'{user_metadata,full_name}',''),auth.jwt()->>'email',auth.uid()::text),200),
 case when actor_admin then 'admin' else 'member' end,source_name,new.user_id,new.display_name,changes || jsonb_build_object('activityTitle',(select payload->>'title' from public.content_items where id=new.activity_id)));
 return null;
end;$fn$;

create function private.submit_activity_payment_proof(p_activity_id uuid,p_object_path text,p_expected_user_id uuid,p_expected_payment_status text,p_expected_proof_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set row_security=off set lock_timeout='5s'
as $fn$
declare c public.content_items%rowtype; a public.applications%rowtype; existing public.application_payment_proofs%rowtype; object storage.objects%rowtype; proof_id uuid;
begin
 if auth.uid() is null or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 if p_expected_user_id is null or p_expected_user_id is distinct from auth.uid() then raise exception 'AUTH_CHANGED'; end if;
 select * into c from public.content_items where id=p_activity_id and kind='activity' for update;
 if not found then raise exception 'ACTIVITY_UNAVAILABLE'; end if;
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
 if (object.metadata->>'size')::numeric<=0 or (object.metadata->>'size')::numeric>3145728 or trunc((object.metadata->>'size')::numeric)<>(object.metadata->>'size')::numeric then raise exception 'INVALID_PROOF_METADATA'; end if;
 insert into public.application_payment_proofs(application_id,activity_id,user_id,object_path) values(a.id,a.activity_id,auth.uid(),p_object_path) returning id into proof_id;
 update public.applications set current_payment_proof_id=proof_id,payment_status='pending' where id=a.id;
 return private.registration_state(p_activity_id);
end;$fn$;

-- Remove the old write signatures: a stale browser must fail closed rather than
-- confirm a newer receipt merely because its payment-status text is unchanged.
drop function public.set_activity_registration_payment(uuid,text,text,uuid);
drop function private.set_activity_registration_payment(uuid,text,text,uuid);
create function private.set_activity_registration_payment(p_application_id uuid,p_payment_status text,p_expected_payment_status text,p_expected_user_id uuid,p_expected_proof_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public set row_security=off set lock_timeout='5s'
as $fn$
declare activity uuid; a public.applications%rowtype;
begin
 if auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED'; end if;
 if auth.uid() is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then raise exception 'ADMIN_REQUIRED'; end if;
 if p_expected_user_id is null or p_expected_user_id is distinct from auth.uid() then raise exception 'AUTH_CHANGED'; end if;
 if p_payment_status is null or p_payment_status not in ('unpaid','pending','paid') or p_expected_payment_status is null or p_expected_payment_status not in ('unpaid','pending','paid') then raise exception 'INVALID_PAYMENT_STATUS'; end if;
 select activity_id into activity from public.applications where id=p_application_id;
 if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
 perform 1 from public.content_items where id=activity for update;
 select * into a from public.applications where id=p_application_id for update;
 if a.payment_status is distinct from p_expected_payment_status or a.current_payment_proof_id is distinct from p_expected_proof_id then raise exception 'STALE_PAYMENT_STATUS_OR_PROOF'; end if;
 if a.payment_status<>p_payment_status then update public.applications set payment_status=p_payment_status where id=a.id; end if;
 return private.registration_state(activity,true);
end;$fn$;

create function public.submit_activity_payment_proof(p_activity_id uuid,p_object_path text,p_expected_user_id uuid,p_expected_payment_status text,p_expected_proof_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.submit_activity_payment_proof(p_activity_id,p_object_path,p_expected_user_id,p_expected_payment_status,p_expected_proof_id)$$;
create function public.set_activity_registration_payment(p_application_id uuid,p_payment_status text,p_expected_payment_status text,p_expected_user_id uuid,p_expected_proof_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.set_activity_registration_payment(p_application_id,p_payment_status,p_expected_payment_status,p_expected_user_id,p_expected_proof_id)$$;
revoke all on function private.can_submit_application_payment_proof(uuid),private.can_insert_payment_proof_object(text),private.submit_activity_payment_proof(uuid,text,uuid,text,uuid),private.set_activity_registration_payment(uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_submit_application_payment_proof(uuid),private.can_insert_payment_proof_object(text),private.submit_activity_payment_proof(uuid,text,uuid,text,uuid),private.set_activity_registration_payment(uuid,text,text,uuid,uuid) to authenticated;
revoke all on function public.submit_activity_payment_proof(uuid,text,uuid,text,uuid),public.set_activity_registration_payment(uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.submit_activity_payment_proof(uuid,text,uuid,text,uuid),public.set_activity_registration_payment(uuid,text,text,uuid,uuid) to authenticated;

create function public.get_payment_settings() returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.get_payment_settings()$$;
create function public.save_payment_settings(p_wechat_qr_url text,p_expected_updated_at timestamptz,p_expected_user_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,public as $$select private.save_payment_settings(p_wechat_qr_url,p_expected_updated_at,p_expected_user_id)$$;
revoke all on function private.audit_payment_settings(),private.get_payment_settings(),private.save_payment_settings(text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function private.get_payment_settings(),private.save_payment_settings(text,timestamptz,uuid) to authenticated;
revoke all on function public.get_payment_settings(),public.save_payment_settings(text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.get_payment_settings(),public.save_payment_settings(text,timestamptz,uuid) to authenticated;
commit;
