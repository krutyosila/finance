import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import {
  AUTH_REQUIRED_EVENT,
  createSessionChannel,
  PrivateRequestManager,
  privateRequests,
} from '../src/security';

afterEach(() => {
  privateRequests.clear();
  vi.unstubAllGlobals();
});

describe('cross-tab session signals', () => {
  it('receives logout from another tab and ignores data that is not a session signal', async () => {
    const sender = new BroadcastChannel('still-session');
    const signals: string[] = [];
    let receiver!: ReturnType<typeof createSessionChannel>;
    const received = new Promise<string>((resolve) => {
      receiver = createSessionChannel((signal) => {
        signals.push(signal);
        resolve(signal);
      });
    });
    try {
      sender.postMessage({ amount: '100.00', password: 'must never become a session signal' });
      sender.postMessage('logout');
      await expect(received).resolves.toBe('logout');
      expect(signals).toEqual(['logout']);
    } finally {
      sender.close();
      receiver.close();
    }
  });

  it('works without persistent storage when the browser lacks BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const channel = createSessionChannel(vi.fn());
    expect(() => channel.notify('logout')).not.toThrow();
    expect(() => channel.close()).not.toThrow();
  });
});

describe('private frontend requests', () => {
  it('aborts every open request when a session is cleared', () => {
    const manager = new PrivateRequestManager();
    const context = manager.begin();
    const transactions = manager.begin();
    manager.clear();
    expect(context.signal.aborted).toBe(true);
    expect(transactions.signal.aborted).toBe(true);
  });

  it('rejects a late private response even when the transport ignores abort', () => {
    const manager = new PrivateRequestManager();
    const request = manager.begin();
    manager.clear();
    expect(() => request.assertCurrent()).toThrow('Oturum değişti');
  });

  it('allows a fresh session to load after the old request generation is cleared', () => {
    const manager = new PrivateRequestManager();
    manager.begin();
    manager.clear();
    const next = manager.begin();
    expect(next.signal.aborted).toBe(false);
    expect(() => next.assertCurrent()).not.toThrow();
    next.finish();
    manager.clear();
    expect(next.signal.aborted).toBe(false);
  });
});

describe('private API transport', () => {
  it('uses only same-origin cookies and never the browser HTTP cache', async () => {
    const transport = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', transport);
    await api('/context');
    expect(transport).toHaveBeenCalledWith(
      '/api/context',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it('rejects a response that arrives after logout even if fetch ignores its aborted signal', async () => {
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const result = api('/context');
    const rejected = expect(result).rejects.toThrow('Oturum değişti');
    privateRequests.clear();
    resolveResponse(new Response('{"private":"previous session"}'));
    await rejected;
  });

  it('closes the private workspace on 401 before waiting for a response body', async () => {
    const events = new EventTarget();
    const expired = vi.fn(() => privateRequests.clear());
    events.addEventListener(AUTH_REQUIRED_EVENT, expired);
    vi.stubGlobal('window', events);
    const body = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', async () => ({ status: 401, ok: false, json: body }));
    await expect(api('/transactions')).rejects.toThrow('Oturumunuz sona erdi');
    expect(expired).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it('keeps incorrect login errors inside the login form without resetting another session', async () => {
    const events = new EventTarget();
    const expired = vi.fn();
    events.addEventListener(AUTH_REQUIRED_EVENT, expired);
    vi.stubGlobal('window', events);
    vi.stubGlobal(
      'fetch',
      async () => new Response('{"error":"Giriş bilgileri geçersiz."}', { status: 401 }),
    );
    await expect(
      api('/auth/login', 'POST', { email: 'admin@example.com', password: 'incorrect' }),
    ).rejects.toThrow('Giriş bilgileri geçersiz');
    expect(expired).not.toHaveBeenCalled();
  });
});

function worker({ offline = false, status = 200, redirected = false } = {}) {
  const handlers = new Map<string, (event: any) => void>();
  const cached = new Map<string, Response>([['/offline.html', new Response('Bağlantı gerekli')]]);
  const puts: string[] = [];
  const cache = {
    match: async (request: Request | string) =>
      cached.get(typeof request === 'string' ? request : new URL(request.url).pathname)?.clone(),
    put: async (request: Request | string, response: Response) => {
      const key = typeof request === 'string' ? request : new URL(request.url).pathname;
      puts.push(key);
      cached.set(key, response);
    },
    addAll: async () => undefined,
  };
  const sandbox = {
    self: {
      location: { origin: 'https://finance.example' },
      clients: { claim: async () => undefined },
      addEventListener: (name: string, handler: (event: any) => void) =>
        handlers.set(name, handler),
    },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: async () => {
      if (offline) throw new Error('offline');
      const response = new Response('public asset', {
        status,
        headers: { 'Content-Type': 'text/javascript' },
      });
      if (redirected) {
        Object.defineProperty(response, 'redirected', { value: true });
        Object.defineProperty(response, 'url', { value: 'https://finance.example/api/context' });
      }
      return response;
    },
    URL,
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), sandbox);
  function request(path: string, method = 'GET', navigation = false) {
    const request = new Request(`https://finance.example${path}`, { method });
    if (navigation) Object.defineProperty(request, 'mode', { value: 'navigate' });
    let response: Promise<Response> | undefined;
    handlers.get('fetch')!({
      request,
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });
    return response;
  }
  return { request, puts };
}

describe('service worker privacy boundary', () => {
  it('loads current installation metadata and Kasa icons while the legacy Still worker stays active', async () => {
    const origin = 'https://finance.example';
    const keyOf = (request: Request | string) =>
      new URL(typeof request === 'string' ? request : request.url, origin).href;
    const previousManifest = {
      name: 'Still — Kişisel Finans',
      short_name: 'Still',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', purpose: 'maskable' },
      ],
    };
    const previousFiles = new Map([
      ['/manifest.webmanifest', JSON.stringify(previousManifest)],
      ['/offline.html', 'Still offline page'],
      ['/icons/icon.svg', 'Still SVG icon'],
      ['/icons/icon-192.png', 'Still 192px icon'],
      ['/icons/icon-512.png', 'Still 512px icon'],
      ['/icons/maskable-512.png', 'Still maskable icon'],
      ['/icons/apple-touch-icon.png', 'Still Apple icon'],
    ]);
    const previous = new Map(
      [...previousFiles].map(([path, body]) => [keyOf(path), new Response(body)]),
    );
    const handlers = new Map<string, (event: any) => void>();
    const claim = vi.fn(async () => undefined);
    const skipWaiting = vi.fn(async () => undefined);
    const fetchPublic = vi.fn(async (request: Request | string) => {
      const path = new URL(keyOf(request)).pathname;
      const file = new URL(path === '/' ? '../index.html' : `../public${path}`, import.meta.url);
      return new Response(new Uint8Array(readFileSync(file)));
    });
    const open = vi.fn(async (name: string) => {
      expect(name).toBe('still-static-v2');
      return {
        match: async (request: Request | string) => previous.get(keyOf(request))?.clone(),
        put: async (request: Request | string, response: Response) => {
          previous.set(keyOf(request), response);
        },
      };
    });
    vm.runInNewContext(
      readFileSync(new URL('./fixtures/still-sw-v2.js', import.meta.url), 'utf8'),
      {
        self: {
          location: { origin },
          clients: { claim },
          skipWaiting,
          addEventListener: (name: string, handler: (event: any) => void) =>
            handlers.set(name, handler),
        },
        caches: { open },
        fetch: fetchPublic,
        URL,
      },
    );
    const request = async (path: string, navigation = false) => {
      const request = new Request(keyOf(path));
      if (navigation) Object.defineProperty(request, 'mode', { value: 'navigate' });
      let response: Promise<Response> | undefined;
      handlers.get('fetch')!({
        request,
        respondWith: (value: Promise<Response>) => {
          response = value;
        },
      });
      return response || fetchPublic(request);
    };

    const html = await (await request('/', true)).text();
    const links = [...html.matchAll(/<link\b[^>]+>/g)].map(([tag]) => ({
      rel: tag.match(/\brel="([^"]+)"/)?.[1],
      href: tag.match(/\bhref="([^"]+)"/)?.[1],
      type: tag.match(/\btype="([^"]+)"/)?.[1],
    }));
    const manifest = await (
      await request(links.find((link) => link.rel === 'manifest')!.href!)
    ).json();
    const currentManifest = JSON.parse(
      readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'),
    );
    expect(manifest).toEqual(currentManifest);
    for (const icon of manifest.icons) {
      const expectedPath =
        icon.purpose === 'maskable'
          ? '/icons/maskable-512.png'
          : `/icons/icon-${icon.sizes.split('x')[0]}.png`;
      expect(Buffer.from(await (await request(icon.src)).arrayBuffer())).toEqual(
        readFileSync(new URL(`../public${expectedPath}`, import.meta.url)),
      );
    }
    const pageIcons = links.filter((link) => ['icon', 'apple-touch-icon'].includes(link.rel!));
    expect(pageIcons).toHaveLength(4);
    for (const icon of pageIcons) {
      const expectedPath =
        icon.rel === 'apple-touch-icon'
          ? '/icons/apple-touch-icon.png'
          : icon.type === 'image/x-icon'
            ? '/favicon.ico'
            : icon.type === 'image/png'
              ? '/icons/favicon-32.png'
              : '/icons/icon.svg';
      expect(Buffer.from(await (await request(icon.href!)).arrayBuffer())).toEqual(
        readFileSync(new URL(`../public${expectedPath}`, import.meta.url)),
      );
    }
    for (const screen of ['../src/auth.tsx', '../src/pwa.tsx', '../public/offline.html']) {
      const source = readFileSync(new URL(screen, import.meta.url), 'utf8');
      const imageSources = [...source.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(
        (match) => match[1],
      );
      expect(imageSources, `${screen} includes static images`).not.toHaveLength(0);
      for (const src of imageSources) {
        expect(
          Buffer.from(await (await request(src)).arrayBuffer()),
          `${screen} image ${src} receives current asset bytes`,
        ).toEqual(readFileSync(new URL(`../public${src}`, import.meta.url)));
      }
    }
    expect(await previous.get(keyOf('/manifest.webmanifest'))!.clone().json()).toEqual(
      previousManifest,
    );
    expect(claim).not.toHaveBeenCalled();
    expect(skipWaiting).not.toHaveBeenCalled();
  });

  it('migrates Still and stale Kasa public caches while preserving unrelated caches and API requests', async () => {
    const previous = new Map([
      ['/manifest.webmanifest', new Response('old manifest')],
      ['/offline.html', new Response('old offline page')],
    ]);
    const unrelated = new Map([['/other-app.js', new Response('unrelated asset')]]);
    const previousKasa = new Map([['/offline.html', new Response('previous Kasa offline page')]]);
    const previousKasaV2 = new Map([['/offline.html', new Response('Kasa v2 offline page')]]);
    const currentKasa = new Map<string, Response>();
    const stored = new Map<string, Map<string, Response>>([
      ['still-static-v0', new Map()],
      ['still-static-v1', previous],
      ['still-static-v2', new Map()],
      ['kasa-static-v0', new Map()],
      ['kasa-static-v1', previousKasa],
      ['kasa-static-v2', previousKasaV2],
      ['kasa-static-v3', currentKasa],
      ['other-app-static-v1', unrelated],
    ]);
    const publicContent = new Map([
      ['/manifest.webmanifest', 'new manifest'],
      ['/kasa-v2.webmanifest', 'new manifest'],
      ['/offline.html', 'new offline page'],
      ['/theme-bootstrap-v1.js', 'appearance bootstrap'],
      ['/brand/kasa-mark.svg', 'Kasa mark'],
      ['/brand/kasa-mark-mint.svg', 'Kasa mint mark'],
      ['/brand/kasa-logo.svg', 'Kasa logo'],
      ['/brand/kasa-logo-light.svg', 'Kasa light logo'],
      ['/favicon.ico', 'Kasa favicon'],
      ['/kasa-favicon-v2.ico', 'versioned Kasa favicon'],
      ['/icons/favicon-32.png', 'Kasa small favicon'],
      ['/icons/kasa-favicon-32-v2.png', 'versioned Kasa small favicon'],
      ['/icons/kasa-favicon-v2.svg', 'versioned Kasa SVG favicon'],
      ['/icons/kasa-icon-192-v2.png', 'versioned Kasa 192px icon'],
      ['/icons/kasa-icon-512-v2.png', 'versioned Kasa 512px icon'],
      ['/icons/kasa-maskable-512-v2.png', 'versioned Kasa maskable icon'],
      ['/icons/kasa-apple-touch-icon-v2.png', 'versioned Kasa Apple icon'],
    ]);
    const handlers = new Map<string, (event: any) => void>();
    const keyOf = (request: Request | string) =>
      typeof request === 'string' ? request : new URL(request.url).pathname;
    const fetchPublic = vi.fn(
      async (request: Request | string) =>
        new Response(publicContent.get(keyOf(request)) || 'public icon'),
    );
    const claim = vi.fn(async () => undefined);
    const sandbox = {
      self: {
        location: { origin: 'https://finance.example' },
        clients: { claim },
        addEventListener: (name: string, handler: (event: any) => void) =>
          handlers.set(name, handler),
      },
      caches: {
        open: async (name: string) => {
          if (!stored.has(name)) stored.set(name, new Map());
          const entries = stored.get(name)!;
          return {
            match: async (request: Request | string) => entries.get(keyOf(request))?.clone(),
            put: async (request: Request | string, response: Response) => {
              entries.set(keyOf(request), response);
            },
            addAll: async (paths: string[]) => {
              for (const path of paths) entries.set(path, await fetchPublic(path));
            },
          };
        },
        keys: async () => [...stored.keys()],
        delete: async (name: string) => stored.delete(name),
      },
      fetch: fetchPublic,
      URL,
    };
    vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), sandbox);
    const lifecycle = async (name: string) => {
      let pending: Promise<unknown> | undefined;
      handlers.get(name)!({
        waitUntil: (value: Promise<unknown>) => {
          pending = value;
        },
      });
      await pending;
    };
    const request = (path: string) => {
      let response: Promise<Response> | undefined;
      handlers.get('fetch')!({
        request: new Request(`https://finance.example${path}`),
        respondWith: (value: Promise<Response>) => {
          response = value;
        },
      });
      return response;
    };

    await lifecycle('install');
    expect(await previous.get('/manifest.webmanifest')!.clone().text()).toBe('old manifest');
    expect(await previous.get('/offline.html')!.clone().text()).toBe('old offline page');
    expect(await previousKasa.get('/offline.html')!.clone().text()).toBe(
      'previous Kasa offline page',
    );
    expect(await previousKasaV2.get('/offline.html')!.clone().text()).toBe('Kasa v2 offline page');
    expect(claim).not.toHaveBeenCalled();
    await lifecycle('activate');
    expect(stored.has('still-static-v0')).toBe(false);
    expect(stored.has('still-static-v1')).toBe(false);
    expect(stored.has('still-static-v2')).toBe(false);
    expect(stored.has('kasa-static-v0')).toBe(false);
    expect(stored.has('kasa-static-v1')).toBe(false);
    expect(stored.has('kasa-static-v2')).toBe(false);
    expect(stored.get('kasa-static-v3')).toBe(currentKasa);
    expect([...stored.keys()].sort()).toEqual(['kasa-static-v3', 'other-app-static-v1']);
    expect(stored.get('other-app-static-v1')).toBe(unrelated);
    expect(claim).toHaveBeenCalledOnce();

    const fetchedDuringInstall = fetchPublic.mock.calls.length;
    for (const [path, content] of publicContent) {
      expect(await currentKasa.get(path)!.clone().text()).toBe(content);
      expect(await (await request(path))!.text()).toBe(content);
    }
    expect(request('/api/context')).toBeUndefined();
    expect(request('/api/auth/session')).toBeUndefined();
    expect(fetchPublic).toHaveBeenCalledTimes(fetchedDuringInstall);
  });

  it('never handles financial API reads or authentication requests', () => {
    const sw = worker();
    expect(sw.request('/api/context')).toBeUndefined();
    expect(sw.request('/api/auth/session')).toBeUndefined();
    expect(sw.request('/api/auth/login', 'POST')).toBeUndefined();
    expect(sw.request('/api/export', 'POST')).toBeUndefined();
    expect(sw.puts).toEqual([]);
  });

  it('does not treat exported files or arbitrary same-origin URLs as public assets', () => {
    const sw = worker();
    expect(sw.request('/exports/financial_snapshot.json')).toBeUndefined();
    expect(sw.request('/backups/finance.sqlite')).toBeUndefined();
    expect(sw.request('/unknown.json')).toBeUndefined();
  });

  it('caches only successful allowed static assets', async () => {
    const sw = worker();
    expect(await (await sw.request('/assets/app-a1b2.js'))!.text()).toBe('public asset');
    expect(sw.puts).toEqual(['/assets/app-a1b2.js']);
    const unauthorized = worker({ status: 401 });
    expect((await unauthorized.request('/assets/app-a1b2.js'))!.status).toBe(401);
    expect(unauthorized.puts).toEqual([]);
  });

  it('never caches a static asset request that redirected to private data', async () => {
    const sw = worker({ redirected: true });
    await sw.request('/assets/app-a1b2.js');
    expect(sw.puts).toEqual([]);
  });

  it('shows a static explanation when navigation is offline, without private data', async () => {
    const sw = worker({ offline: true });
    expect(await (await sw.request('/', 'GET', true))!.text()).toBe('Bağlantı gerekli');
    expect(sw.puts).toEqual([]);
  });
});
