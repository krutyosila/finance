import { useCallback, useEffect, useState } from 'react';
import { AUTH_REQUIRED_EVENT, privateRequests } from './security';

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
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry((value) => value + 1), []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    api<T>(path)
      .then((value) => {
        if (current) setData(value);
      })
      .catch((reason) => {
        if (current) setError(reason.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path, revision, retry]);
  return { data, error, loading, refresh };
}
