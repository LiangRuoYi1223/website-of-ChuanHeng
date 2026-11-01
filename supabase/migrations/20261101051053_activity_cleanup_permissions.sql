begin;
-- All access goes through identity-bound RPCs. Explicit restrictive policies
-- document the existing default-deny boundary without granting table access.
do $permissions$
declare target_table text;
begin
 foreach target_table in array array['member_profiles','activity_registration_details','activity_data_cleanup','cleanup_confirmations'] loop
  execute format('create policy site_direct_access_denied on private.%I as restrictive for all to anon,authenticated using(false) with check(false)',target_table);
 end loop;
 -- Hosted extension installation applies platform grants after CREATE EXTENSION.
 -- This follow-up migration removes website access; postgres Cron stays intact.
 if to_regnamespace('net') is not null then
  execute 'revoke usage on schema net from public,anon,authenticated';
  execute 'revoke all on all functions in schema net from public,anon,authenticated';
  execute 'revoke all on all tables in schema net from public,anon,authenticated';
  execute 'revoke all on all sequences in schema net from public,anon,authenticated';
 end if;
end;
$permissions$;
commit;
