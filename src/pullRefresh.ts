import { useEffect, useRef, useState } from 'react';

const idle = { claimed: false, distance: 0, ready: false };

export function createPullGesture() {
  let start: { x: number; y: number } | null = null;
  let claimed = false;
  let ready = false;
  function cancel() {
    start = null;
    claimed = false;
    ready = false;
  }
  return {
    start(x: number, y: number) {
      cancel();
      start = { x, y };
    },
    move(x: number, y: number, cancelable = true) {
      if (!start) return idle;
      const dx = Math.abs(x - start.x);
      const dy = y - start.y;
      if (!cancelable || dy < 0 || (!claimed && dx > 8 && dx >= dy * 0.8)) {
        cancel();
        return idle;
      }
      if (!claimed && dy < 8) return idle;
      claimed = true;
      ready = dy >= 96;
      return { claimed, distance: Math.min(60, dy * 0.5), ready };
    },
    end() {
      const refresh = claimed && ready;
      cancel();
      return refresh;
    },
    cancel,
  };
}

function blocked() {
  return (
    document.querySelector('dialog[open]') !== null ||
    document.body.classList.contains('dialog-open') ||
    document.body.classList.contains('mobile-nav-open') ||
    (window.visualViewport?.scale ?? 1) !== 1 ||
    document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')
  );
}

function canStart(target: EventTarget | null) {
  if (!(target instanceof Element) || !target.closest('#main-content')) return false;
  if (
    target.closest('input, textarea, select, button, a, label, [contenteditable], [role="button"]')
  )
    return false;
  for (
    let element: Element | null = target;
    element && element.id !== 'main-content';
    element = element.parentElement
  ) {
    const style = window.getComputedStyle(element);
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1)
      return false;
    if (/(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1)
      return false;
  }
  return true;
}

export function usePullRefresh({
  enabled,
  page,
  refresh,
  onError,
}: {
  enabled: boolean;
  page: string;
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [pull, setPull] = useState(idle);
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef(false);
  const callbacks = useRef({ refresh, onError });
  callbacks.current = { refresh, onError };
  useEffect(() => {
    if (!enabled) return;
    const gesture = createPullGesture();
    const cancel = () => {
      gesture.cancel();
      setPull(idle);
    };
    const start = (event: TouchEvent) => {
      cancel();
      if (
        running.current ||
        blocked() ||
        event.touches.length !== 1 ||
        window.scrollY > 1 ||
        !canStart(event.target)
      )
        return;
      gesture.start(event.touches[0].clientX, event.touches[0].clientY);
    };
    const move = (event: TouchEvent) => {
      if (blocked() || running.current || event.touches.length !== 1 || window.scrollY > 1) {
        cancel();
        return;
      }
      const next = gesture.move(
        event.touches[0].clientX,
        event.touches[0].clientY,
        event.cancelable,
      );
      if (next.claimed) event.preventDefault();
      setPull(next);
    };
    const end = () => {
      const shouldRefresh = !blocked() && !running.current && gesture.end();
      cancel();
      if (!shouldRefresh) return;
      running.current = true;
      setRefreshing(true);
      void Promise.resolve()
        .then(() => callbacks.current.refresh())
        .catch((error: unknown) => {
          callbacks.current.onError(error);
        })
        .finally(() => {
          running.current = false;
          setRefreshing(false);
        });
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', cancel);
    return () => {
      cancel();
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', cancel);
    };
  }, [enabled, page]);
  return { ...pull, refreshing };
}
