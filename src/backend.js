import { createClient } from '@supabase/supabase-js';

// The browser may only receive a publishable key or a legacy anon JWT.
// This validates configuration, not user identity; Auth and RLS authorize users.
export function resolvePublicBackendConfiguration(env = {}) {
  const url = String(env.VITE_SUPABASE_URL || '').trim();
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !key) return { configured: false, error: '尚未连接云端服务' };
  try {
    const parsed = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error();
    if (parsed.username || parsed.password) throw new Error();
  } catch {
    return { configured: false, error: '云端地址配置无效，请使用 HTTPS 项目地址' };
  }
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey && key.split('.').length === 3) {
    try {
      const segment = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, '=')));
      publicKey = payload.role === 'anon';
    } catch { publicKey = false; }
  }
  if (!publicKey) return { configured: false, error: '前端仅允许 publishable 或 anon 公钥，请检查配置' };
  return { configured: true, url, key, error: '' };
}

const configuration = resolvePublicBackendConfiguration(import.meta.env ?? {});
export const supabase = configuration.configured
  ? createClient(configuration.url, configuration.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
export const isBackendConfigured = Boolean(supabase);
export const backendConfigurationError = configuration.error;
