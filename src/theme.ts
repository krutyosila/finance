import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeEnvironment {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  media?: {
    readonly matches: boolean;
    addEventListener: (type: 'change', listener: () => void) => void;
    removeEventListener: (type: 'change', listener: () => void) => void;
  };
  applyTheme: (theme: ResolvedTheme) => void;
  subscribeToStorage?: (listener: (value: string | null) => void) => () => void;
}

const storageKey = 'kasa-theme';

function preferenceFromStorage(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function createThemeController(environment: ThemeEnvironment) {
  const listeners = new Set<() => void>();
  let preference: ThemePreference = 'system';
  try {
    preference = preferenceFromStorage(environment.storage?.getItem(storageKey) ?? null);
  } catch {
    // Browser privacy settings can disable storage without disabling appearance controls.
  }
  const resolve = (value: ThemePreference): ResolvedTheme =>
    value === 'system' ? (environment.media?.matches ? 'dark' : 'light') : value;
  let snapshot = { preference, resolved: resolve(preference) };
  environment.applyTheme(snapshot.resolved);

  function update(value: ThemePreference) {
    const resolved = resolve(value);
    if (value === snapshot.preference && resolved === snapshot.resolved) return;
    if (resolved !== snapshot.resolved) environment.applyTheme(resolved);
    snapshot = { preference: value, resolved };
    for (const listener of listeners) listener();
  }
  const systemChanged = () => {
    if (snapshot.preference === 'system') update('system');
  };
  environment.media?.addEventListener('change', systemChanged);
  const stopStorage = environment.subscribeToStorage?.((value) =>
    update(preferenceFromStorage(value)),
  );

  return {
    getSnapshot: () => snapshot,
    setPreference: (value: ThemePreference) => {
      try {
        environment.storage?.setItem(storageKey, value);
      } catch {
        // The current selection still works when saving it is unavailable.
      }
      update(value);
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      environment.media?.removeEventListener('change', systemChanged);
      stopStorage?.();
      listeners.clear();
    },
  };
}

function browserEnvironment(): ThemeEnvironment {
  let storage: ThemeEnvironment['storage'];
  let media: ThemeEnvironment['media'];
  try {
    storage = window.localStorage;
  } catch {
    // Storage can also throw while accessing the browser property itself.
  }
  try {
    media = window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    // Use the light appearance when this browser cannot report a system preference.
  }
  return {
    storage,
    media,
    applyTheme: (theme) => {
      document.documentElement.dataset.theme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'dark' ? '#14232c' : '#ffffff');
    },
    subscribeToStorage: (listener) => {
      const changed = (event: StorageEvent) => {
        if (event.storageArea === storage && (event.key === storageKey || event.key === null))
          listener(event.newValue);
      };
      window.addEventListener('storage', changed);
      return () => window.removeEventListener('storage', changed);
    },
  };
}

let browserTheme: ReturnType<typeof createThemeController> | undefined;

export function initializeTheme() {
  return (browserTheme ??= createThemeController(browserEnvironment()));
}

export function useTheme() {
  const controller = initializeTheme();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { ...snapshot, setPreference: controller.setPreference };
}
