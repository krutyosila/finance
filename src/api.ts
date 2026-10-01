import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AUTH_REQUIRED_EVENT, privateRequests } from './security';
import { createResourceRequestGuard, useResourceRefreshCoordinator } from './resourceRefresh';

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const request = privateRequests.begin();
  try {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: request.signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => {
      request.assertCurrent();
      throw new Error('Sunucuya bağlanılamadı. Bağlantınızı ve hizmetin çalıştığını kontrol edin.');
    });
    request.assertCurrent();
    if (response.status === 401 && !path.startsWith('/auth/') && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      throw new Error('Oturumunuz sona erdi. Yeniden giriş yapın.');
    }
    const data = await response.json().catch(() => ({ error: 'Sunucunun yanıtı okunamadı.' }));
    request.assertCurrent();
    if (!response.ok) throw new Error(data.error || `İstek tamamlanamadı (${response.status}).`);
    return data as T;
  } finally {
    request.finish();
  }
}

export function useResource<T>(path: string, revision = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const guard = useRef(createResourceRequestGuard());
  const coordinator = useResourceRefreshCoordinator();
  useLayoutEffect(() => {
    guard.current.setScope(path, revision);
    guard.current.mount();
    return () => guard.current.unmount();
  }, [path, revision]);
  const reload = useCallback(async () => {
    const current = guard.current.begin(path, revision);
    if (!current()) return;
    setLoading(true);
    setError('');
    try {
      const value = await api<T>(path);
      if (current()) setData(value);
    } catch (reason) {
      if (current()) setError((reason as Error).message);
      throw reason;
    } finally {
      if (current()) setLoading(false);
    }
  }, [path, revision]);
  const refresh = useCallback(() => {
    void reload().catch(() => {});
  }, [reload]);
  useEffect(refresh, [refresh]);
  useEffect(() => coordinator?.register(reload), [coordinator, reload]);
  return { data, error, loading, refresh, reload };
}
