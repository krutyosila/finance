export const AUTH_REQUIRED_EVENT = 'still:auth-required';

export class PrivateRequestManager {
  private generation = 0;
  private controllers = new Set<AbortController>();

  begin() {
    const generation = this.generation;
    const controller = new AbortController();
    this.controllers.add(controller);
    return {
      signal: controller.signal,
      assertCurrent: () => {
        if (generation !== this.generation) throw new Error('Oturum değişti. Yeniden giriş yapın.');
      },
      finish: () => this.controllers.delete(controller),
    };
  }

  clear() {
    this.generation += 1;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}

export const privateRequests = new PrivateRequestManager();

export interface AuthSession {
  required: boolean;
  authenticated: boolean;
  user: { email: string; role: 'ADMIN' } | null;
}

export function canOpenFinancialWorkspace(session: AuthSession) {
  return !session.required || session.authenticated;
}

type SessionSignal = 'logout' | 'session-changed';

export function createSessionChannel(onChange: (signal: SessionSignal) => void) {
  const channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('still-session');
  if (channel)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === 'logout' || event.data === 'session-changed') onChange(event.data);
    };
  return {
    notify: (signal: SessionSignal) => channel?.postMessage(signal),
    close: () => channel?.close(),
  };
}
