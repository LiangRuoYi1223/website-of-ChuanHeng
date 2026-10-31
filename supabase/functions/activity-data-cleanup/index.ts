import { createCleanupApi, handleCleanupWake } from './cleanup.mjs';

// Platform secrets stay here; no privileged key is copied into a browser bundle.
Deno.serve((request: Request) => {
  let api;
  try {
    let key: string | undefined;
    try { key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default; } catch { /* legacy platform fallback */ }
    key ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    api = createCleanupApi({ url: Deno.env.get('SUPABASE_URL'), secretKey: key });
  } catch { /* Missing service configuration produces a safe retry response. */ }
  return handleCleanupWake(request, { api });
});
