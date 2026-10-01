import { describe, expect, it, vi } from 'vitest';
import { createThemeController, type ThemeEnvironment, type ThemePreference } from '../src/theme';

function browserTheme({
  saved = null,
  dark = false,
  unavailable = false,
}: {
  saved?: string | null;
  dark?: boolean;
  unavailable?: boolean;
} = {}) {
  const values = new Map<string, string>();
  if (saved !== null) values.set('kasa-theme', saved);
  const mediaListeners = new Set<() => void>();
  const storageListeners = new Set<(value: string | null) => void>();
  const applied: string[] = [];
  const media = {
    matches: dark,
    addEventListener: (_type: 'change', listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: 'change', listener: () => void) => mediaListeners.delete(listener),
  };
  const environment: ThemeEnvironment = {
    storage: {
      getItem: (key) => {
        if (unavailable) throw new Error('Storage blocked');
        return values.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (unavailable) throw new Error('Storage blocked');
        values.set(key, value);
      },
    },
    media,
    applyTheme: (theme) => applied.push(theme),
    subscribeToStorage: (listener) => {
      storageListeners.add(listener);
      return () => storageListeners.delete(listener);
    },
  };
  const controller = createThemeController(environment);
  return {
    controller,
    values,
    applied,
    mediaListeners,
    storageListeners,
    changeSystem: (value: boolean) => {
      media.matches = value;
      for (const listener of mediaListeners) listener();
    },
    changeOtherTab: (value: string | null) => {
      for (const listener of storageListeners) listener(value);
    },
  };
}

describe('appearance preference', () => {
  it('starts with the current system theme and applies it before any subscriptions', () => {
    const { controller, applied } = browserTheme({ dark: true });
    expect(controller.getSnapshot()).toEqual({ preference: 'system', resolved: 'dark' });
    expect(applied).toEqual(['dark']);
  });

  it('follows system changes until the user selects a manual theme', () => {
    const browser = browserTheme();
    const changed = vi.fn();
    browser.controller.subscribe(changed);
    browser.changeSystem(true);
    expect(browser.controller.getSnapshot()).toEqual({ preference: 'system', resolved: 'dark' });
    browser.controller.setPreference('light');
    expect(browser.values.get('kasa-theme')).toBe('light');
    changed.mockClear();
    browser.changeSystem(false);
    browser.changeSystem(true);
    expect(browser.controller.getSnapshot()).toEqual({ preference: 'light', resolved: 'light' });
    expect(changed).not.toHaveBeenCalled();
    expect(browser.applied).toEqual(['light', 'dark', 'light']);
    browser.controller.setPreference('system');
    expect(browser.controller.getSnapshot()).toEqual({ preference: 'system', resolved: 'dark' });
    expect(browser.values.get('kasa-theme')).toBe('system');
  });

  it.each<ThemePreference>(['light', 'dark'])(
    'restores the saved %s choice regardless of the system',
    (saved) => {
      const browser = browserTheme({ saved, dark: saved !== 'dark' });
      expect(browser.controller.getSnapshot()).toEqual({ preference: saved, resolved: saved });
      expect(browser.applied).toEqual([saved]);
    },
  );

  it('treats an invalid saved value as system without breaking startup', () => {
    const browser = browserTheme({ saved: 'invalid', dark: true });
    expect(browser.controller.getSnapshot()).toEqual({ preference: 'system', resolved: 'dark' });
  });

  it('keeps the selection usable when browser storage is blocked', () => {
    const browser = browserTheme({ unavailable: true, dark: true });
    expect(browser.controller.getSnapshot().resolved).toBe('dark');
    expect(() => browser.controller.setPreference('light')).not.toThrow();
    expect(browser.controller.getSnapshot()).toEqual({ preference: 'light', resolved: 'light' });
  });

  it('updates from another tab and falls back to the current system after removal', () => {
    const browser = browserTheme({ saved: 'light', dark: true });
    browser.changeOtherTab('dark');
    expect(browser.controller.getSnapshot()).toEqual({ preference: 'dark', resolved: 'dark' });
    browser.changeOtherTab(null);
    expect(browser.controller.getSnapshot()).toEqual({ preference: 'system', resolved: 'dark' });
  });

  it('unsubscribes UI listeners and removes browser listeners on disposal', () => {
    const browser = browserTheme();
    expect(browser.mediaListeners.size).toBe(1);
    expect(browser.storageListeners.size).toBe(1);
    const changed = vi.fn();
    const unsubscribe = browser.controller.subscribe(changed);
    unsubscribe();
    browser.changeSystem(true);
    expect(changed).not.toHaveBeenCalled();
    browser.controller.dispose();
    expect(browser.mediaListeners.size).toBe(0);
    expect(browser.storageListeners.size).toBe(0);
  });

  it('uses light when system theme information is unavailable', () => {
    const controller = createThemeController({ applyTheme: () => undefined });
    expect(controller.getSnapshot()).toEqual({ preference: 'system', resolved: 'light' });
    controller.setPreference('dark');
    expect(controller.getSnapshot()).toEqual({ preference: 'dark', resolved: 'dark' });
  });
});
