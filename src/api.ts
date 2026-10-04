export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ApiError'; }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && options.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, signal: options.signal ?? AbortSignal.timeout(15000), headers, credentials: 'same-origin' }); }
  catch { throw new ApiError('暂时无法连接服务，请确认网站服务已启动后重试。', 0); }
  const data = await response.json().catch(() => { throw new ApiError('服务返回了无效响应，请确认网站服务已启动后重试。', response.status); });
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('auth-expired'));
    if (response.status === 403) window.dispatchEvent(new Event('auth-recheck'));
    throw new ApiError(data.error || '操作失败，请重试。', response.status, data.code);
  }
  return data as T;
}
