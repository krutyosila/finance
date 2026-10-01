import { useEffect } from 'react';

export function visibleViewportBottom(
  viewport: Pick<VisualViewport, 'height' | 'offsetTop' | 'scale'>,
  layoutHeight = 0,
  editing = false,
) {
  if (
    viewport.scale !== 1 ||
    !Number.isFinite(viewport.height) ||
    viewport.height <= 0 ||
    !Number.isFinite(viewport.offsetTop)
  )
    return null;
  const bottom = Math.max(0, viewport.offsetTop) + viewport.height;
  if (!Number.isFinite(layoutHeight) || layoutHeight <= 0) return bottom;
  // WebKit can retain a keyboard-sized viewport after the focused form is removed.
  if (!editing && layoutHeight - viewport.height > 150) return layoutHeight;
  // A restored viewport can still report the keyboard's old upward pan.
  if (
    viewport.height <= layoutHeight &&
    (layoutHeight - viewport.height <= 1 || (!editing && layoutHeight - viewport.height <= 150))
  )
    return Math.min(bottom, layoutHeight);
  return bottom;
}

export function useMobileViewport(mobile: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!mobile || !viewport) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      const active = document.activeElement;
      const editing =
        (active instanceof HTMLInputElement &&
          !active.readOnly &&
          ![
            'button',
            'checkbox',
            'color',
            'file',
            'hidden',
            'image',
            'radio',
            'range',
            'reset',
            'submit',
          ].includes(active.type)) ||
        (active instanceof HTMLTextAreaElement && !active.readOnly) ||
        (active instanceof HTMLElement && active.isContentEditable);
      const bottom = visibleViewportBottom(viewport, window.innerHeight, editing);
      if (bottom === null) {
        root.classList.remove('visual-viewport-dock');
        root.style.removeProperty('--mobile-dock-bottom');
      } else {
        root.style.setProperty('--mobile-dock-bottom', `${bottom}px`);
        root.classList.add('visual-viewport-dock');
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('pageshow', schedule);
    document.addEventListener('focusout', schedule);
    document.addEventListener('focusin', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pageshow', schedule);
      document.removeEventListener('focusout', schedule);
      document.removeEventListener('focusin', schedule);
      root.classList.remove('visual-viewport-dock');
      root.style.removeProperty('--mobile-dock-bottom');
    };
  }, [mobile]);
}
