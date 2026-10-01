import { describe, expect, it } from 'vitest';
import {
  createResourceRefreshCoordinator,
  createResourceRequestGuard,
} from '../src/resourceRefresh';

function pending() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('current page resource refresh', () => {
  it('waits for every mounted resource to finish', async () => {
    const refresh = createResourceRefreshCoordinator();
    const report = pending();
    const cycles = pending();
    refresh.register(() => report.promise);
    refresh.register(() => cycles.promise);
    let complete = false;
    const request = refresh.refreshAll().then(() => {
      complete = true;
    });
    report.resolve();
    await Promise.resolve();
    expect(complete).toBe(false);
    cycles.resolve();
    await request;
    expect(complete).toBe(true);
  });

  it('does not finish on the first failure while another fetch is pending', async () => {
    const refresh = createResourceRefreshCoordinator();
    const settings = pending();
    const labels = pending();
    refresh.register(() => settings.promise);
    refresh.register(() => labels.promise);
    let finished = false;
    const result = refresh.refreshAll().catch((error) => {
      finished = true;
      return error;
    });
    settings.reject(new Error('Connection unavailable'));
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    labels.resolve();
    expect(await result).toEqual(new Error('Connection unavailable'));
  });

  it('removes unmounted page resources from future refreshes', async () => {
    const refresh = createResourceRefreshCoordinator();
    const loaded: string[] = [];
    const remove = refresh.register(async () => {
      loaded.push('transactions');
    });
    remove();
    refresh.register(async () => {
      loaded.push('labels');
    });
    await refresh.refreshAll();
    expect(loaded).toEqual(['labels']);
  });

  it('starts all fetches even if one callback throws synchronously', async () => {
    const refresh = createResourceRefreshCoordinator();
    let labelsLoaded = false;
    refresh.register(() => {
      throw new Error('Unavailable');
    });
    refresh.register(async () => {
      labelsLoaded = true;
    });
    await expect(refresh.refreshAll()).rejects.toThrow('Unavailable');
    expect(labelsLoaded).toBe(true);
  });

  it('snapshots current resources so page changes cannot add a new page to an in-flight pull', async () => {
    const refresh = createResourceRefreshCoordinator();
    const oldPage = pending();
    let newPageCalls = 0;
    const remove = refresh.register(() => oldPage.promise);
    const request = refresh.refreshAll();
    remove();
    refresh.register(async () => {
      newPageCalls++;
    });
    oldPage.resolve();
    await request;
    expect(newPageCalls).toBe(0);
    await refresh.refreshAll();
    expect(newPageCalls).toBe(1);
  });

  it('resolves an empty page without a request', async () => {
    await expect(createResourceRefreshCoordinator().refreshAll()).resolves.toBeUndefined();
  });
});

describe('resource response ownership', () => {
  it('ignores an older pull response after a newer reload begins', () => {
    const guard = createResourceRequestGuard();
    guard.setScope('/transactions?labelId=food', 0);
    guard.mount();
    const oldPull = guard.begin();
    const newest = guard.begin();
    expect(oldPull()).toBe(false);
    expect(newest()).toBe(true);
  });

  it('invalidates pending responses as soon as the request path changes', () => {
    const guard = createResourceRequestGuard();
    guard.setScope('/transactions?labelId=food', 0);
    guard.mount();
    const oldFilter = guard.begin();
    guard.setScope('/transactions?labelId=home', 0);
    expect(oldFilter()).toBe(false);
  });

  it('invalidates responses after a mutation revision changes', () => {
    const guard = createResourceRequestGuard();
    guard.setScope('/context', 0);
    guard.mount();
    const previousData = guard.begin();
    guard.setScope('/context', 1);
    expect(previousData()).toBe(false);
  });

  it('ignores responses after unmount and allows a fresh mounted request', () => {
    const guard = createResourceRequestGuard();
    guard.setScope('/labels', 0);
    guard.mount();
    const old = guard.begin();
    guard.unmount();
    expect(old()).toBe(false);
    guard.mount();
    expect(old()).toBe(false);
    expect(guard.begin()()).toBe(true);
  });

  it('keeps a pending response valid during ordinary same-scope renders', () => {
    const guard = createResourceRequestGuard();
    guard.setScope('/labels', 0);
    guard.mount();
    const current = guard.begin();
    guard.setScope('/labels', 0);
    expect(current()).toBe(true);
  });
});
