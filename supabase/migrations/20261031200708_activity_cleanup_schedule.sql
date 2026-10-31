-- Local isolated engines do not ship these platform extensions. The hosted
-- deployment must verify that this branch installs one active 3-minute job.
begin;
create function private.authorize_activity_cleanup_wake(p_token text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $auth$
declare stored text;
begin
 if p_token is null or p_token!~'^[0-9a-fA-F-]{72}$' or to_regclass('vault.decrypted_secrets') is null then return false;end if;
 execute 'select decrypted_secret from vault.decrypted_secrets where name=$1' into strict stored using 'activity_cleanup_wake_token';
 return sha256(convert_to(p_token,'UTF8'))=sha256(convert_to(stored,'UTF8'));
exception when no_data_found or too_many_rows then return false;
end;
$auth$;
revoke all on function private.authorize_activity_cleanup_wake(text) from public,anon,authenticated;
grant execute on function private.authorize_activity_cleanup_wake(text) to service_role;
create function public.authorize_activity_cleanup_wake(p_token text) returns boolean
language sql security invoker set search_path=pg_catalog,public as $$select private.authorize_activity_cleanup_wake(p_token)$$;
revoke all on function public.authorize_activity_cleanup_wake(text) from public,anon,authenticated;
grant execute on function public.authorize_activity_cleanup_wake(text) to service_role;
do $schedule$
begin
 if not exists(select 1 from pg_available_extensions where name='pg_cron')
 or not exists(select 1 from pg_available_extensions where name='pg_net') then
  return;
 end if;
 execute 'create extension if not exists pg_cron with schema pg_catalog';
 execute 'create extension if not exists pg_net';
 execute 'revoke usage on schema cron,net from public,anon,authenticated';
 if not exists(select 1 from vault.secrets where name='activity_cleanup_wake_token') then
  perform vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,'activity_cleanup_wake_token','Activity cleanup scheduler only');
 end if;
 perform cron.schedule('activity-data-cleanup','*/3 * * * *', $job$
  select net.http_post(
   url:='https://gftecgpbhiubrkmazlcu.supabase.co/functions/v1/activity-data-cleanup',
   headers:=jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_RS90uXHY6XrNnDqB1qBGuw_4d1mRLI8','x-cleanup-token',(select decrypted_secret from vault.decrypted_secrets where name='activity_cleanup_wake_token')),
   body:='{}'::jsonb,
   timeout_milliseconds:=60000
  );
 $job$);
end;
$schedule$;
commit;
