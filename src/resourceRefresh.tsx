import { createContext, useContext, type ReactNode } from 'react';

type ReloadResource = () => Promise<void>;

export function createResourceRefreshCoordinator() {
  const resources = new Set<ReloadResource>();
  return {
    register(reload: ReloadResource) {
      resources.add(reload);
      return () => {
        resources.delete(reload);
      };
    },
    async refreshAll() {
      const current = [...resources];
      const results = await Promise.allSettled(
        current.map((reload) => Promise.resolve().then(reload)),
      );
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    },
  };
}

type ResourceRefreshCoordinator = ReturnType<typeof createResourceRefreshCoordinator>;
const ResourceRefreshContext = createContext<ResourceRefreshCoordinator | null>(null);

export function ResourceRefreshProvider({
  coordinator,
  children,
}: {
  coordinator: ResourceRefreshCoordinator;
  children: ReactNode;
}) {
  return (
    <ResourceRefreshContext.Provider value={coordinator}>
      {children}
    </ResourceRefreshContext.Provider>
  );
}

export function useResourceRefreshCoordinator() {
  return useContext(ResourceRefreshContext);
}

export function createResourceRequestGuard() {
  let path = '';
  let revision = 0;
  let generation = 0;
  let mounted = false;
  return {
    setScope(nextPath: string, nextRevision: number) {
      if (nextPath !== path || nextRevision !== revision) {
        path = nextPath;
        revision = nextRevision;
        generation++;
      }
    },
    mount() {
      mounted = true;
    },
    unmount() {
      mounted = false;
      generation++;
    },
    begin(requestPath = path, requestRevision = revision) {
      if (requestPath !== path || requestRevision !== revision) return () => false;
      const request = ++generation;
      return () => mounted && request === generation;
    },
  };
}
