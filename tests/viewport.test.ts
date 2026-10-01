import { describe, expect, it } from 'vitest';
import { visibleViewportBottom } from '../src/viewport';

describe('mobile dock viewport recovery', () => {
  it('uses the visible keyboard boundary while an editable field is focused', () => {
    expect(visibleViewportBottom({ height: 320, offsetTop: 100, scale: 1 }, 844, true)).toBe(420);
  });

  it('recovers a stale keyboard height after the login form is unmounted', () => {
    expect(visibleViewportBottom({ height: 320, offsetTop: 100, scale: 1 }, 844, false)).toBe(844);
  });

  it('drops a stale keyboard pan that would push an unfocused dock below the screen', () => {
    expect(visibleViewportBottom({ height: 529, offsetTop: 400, scale: 1 }, 844, false)).toBe(844);
  });

  it('clamps the old keyboard pan when the visible height is restored with the input still focused', () => {
    expect(visibleViewportBottom({ height: 844, offsetTop: 100, scale: 1 }, 844, true)).toBe(844);
  });

  it('retains smaller toolbar offsets without treating them as a keyboard', () => {
    expect(visibleViewportBottom({ height: 784, offsetTop: 30, scale: 1 }, 844, false)).toBe(814);
  });

  it('accepts a visible viewport taller than stale layout metrics', () => {
    expect(visibleViewportBottom({ height: 664, offsetTop: 0, scale: 1 }, 349, false)).toBe(664);
  });

  it('lets the browser position navigation during pinch zoom', () => {
    expect(visibleViewportBottom({ height: 422, offsetTop: 100, scale: 2 }, 844, true)).toBeNull();
  });

  it('ignores invalid temporary viewport measurements', () => {
    expect(visibleViewportBottom({ height: 0, offsetTop: 100, scale: 1 })).toBeNull();
    expect(visibleViewportBottom({ height: 320, offsetTop: Number.NaN, scale: 1 })).toBeNull();
  });
});
