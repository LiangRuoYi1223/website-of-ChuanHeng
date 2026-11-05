const retainedEvents=new Set(['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED']);

// Repeated Supabase identity notifications do not imply an account change.
// This only preserves an existing view; server authorization remains mandatory.
export function shouldInvalidateAuthEvent(event,session,expectedUserId,{requireAdmin=false}={}){
  if(event==='INITIAL_SESSION'&&!session&&!expectedUserId)return false;
  if(!retainedEvents.has(event))return true;
  const user=session?.user;
  if(!user?.id||user.is_anonymous===true)return true;
  if(requireAdmin&&user.app_metadata?.role!=='admin')return true;
  return Boolean(expectedUserId&&user.id!==expectedUserId);
}
