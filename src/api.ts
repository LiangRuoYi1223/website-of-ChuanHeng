export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ApiError'; }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({ error: '服务返回了无效响应，请稍后重试。' }));
  if (!response.ok) throw new ApiError(data.error || '操作失败，请重试。', response.status, data.code);
  return data as T;
}
