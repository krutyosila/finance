import { describe, expect, it } from 'vitest';
import { createPullGesture } from '../src/pullRefresh';

describe('pull-to-refresh gesture', () => {
  it('claims a downward pull and refreshes only on release beyond the threshold', () => {
    const gesture = createPullGesture();
    gesture.start(50, 100);
    expect(gesture.move(50, 105)).toEqual({ claimed: false, distance: 0, ready: false });
    expect(gesture.move(52, 160)).toMatchObject({ claimed: true, ready: false });
    expect(gesture.move(54, 205)).toMatchObject({ claimed: true, ready: true });
    expect(gesture.end()).toBe(true);
    expect(gesture.end()).toBe(false);
  });

  it('caps the visual pull distance without changing the trigger threshold', () => {
    const gesture = createPullGesture();
    gesture.start(50, 100);
    expect(gesture.move(50, 900)).toEqual({ claimed: true, distance: 60, ready: true });
  });

  it('does not refresh after a short pull or a pull that retreats', () => {
    const gesture = createPullGesture();
    gesture.start(50, 100);
    gesture.move(50, 180);
    expect(gesture.end()).toBe(false);
    gesture.start(50, 100);
    gesture.move(50, 230);
    expect(gesture.move(50, 150).ready).toBe(false);
    expect(gesture.end()).toBe(false);
  });

  it.each([
    [100, 102],
    [52, 80],
    [80, 120],
  ])('leaves horizontal or upward gestures to the browser (%s, %s)', (x, y) => {
    const gesture = createPullGesture();
    gesture.start(50, 100);
    expect(gesture.move(x, y).claimed).toBe(false);
    expect(gesture.move(50, 250).claimed).toBe(false);
    expect(gesture.end()).toBe(false);
  });

  it('discards a cancelled or browser-owned gesture', () => {
    const gesture = createPullGesture();
    gesture.start(50, 100);
    gesture.move(50, 230);
    gesture.cancel();
    expect(gesture.end()).toBe(false);
    gesture.start(50, 100);
    expect(gesture.move(50, 230, false).claimed).toBe(false);
    expect(gesture.end()).toBe(false);
  });

  it('does not claim touch movement without a valid start', () => {
    const gesture = createPullGesture();
    expect(gesture.move(50, 230).claimed).toBe(false);
    expect(gesture.end()).toBe(false);
  });
});
