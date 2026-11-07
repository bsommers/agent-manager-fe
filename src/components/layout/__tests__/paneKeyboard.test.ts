import { describe, it, expect } from 'vitest';
import {
  PANE_STEP,
  PANE_STEP_LARGE,
  PANE_MIN_X,
  PANE_MIN_Y,
  PANE_MIN_WIDTH,
  PANE_MIN_HEIGHT,
  isArrowKey,
  movePane,
  resizePane,
} from '../paneKeyboard';

describe('paneKeyboard constants', () => {
  it('pins the documented steps and minimums', () => {
    expect(PANE_STEP).toBe(10);
    expect(PANE_STEP_LARGE).toBe(50);
    expect([PANE_MIN_X, PANE_MIN_Y]).toEqual([10, 50]);
    expect([PANE_MIN_WIDTH, PANE_MIN_HEIGHT]).toEqual([300, 200]);
  });
});

describe('isArrowKey', () => {
  it.each([
    ['ArrowLeft', true],
    ['ArrowRight', true],
    ['ArrowUp', true],
    ['ArrowDown', true],
    ['a', false],
    ['Enter', false],
    [' ', false],
    ['Tab', false],
    ['Home', false],
  ])('%s -> %s', (key, expected) => {
    expect(isArrowKey(key)).toBe(expected);
  });
});

describe('movePane', () => {
  const from = { x: 100, y: 100 };
  it.each([
    ['ArrowRight', false, { x: 110, y: 100 }],
    ['ArrowLeft', false, { x: 90, y: 100 }],
    ['ArrowDown', false, { x: 100, y: 110 }],
    ['ArrowUp', false, { x: 100, y: 90 }],
    ['ArrowRight', true, { x: 150, y: 100 }],
    ['ArrowLeft', true, { x: 50, y: 100 }],
    ['ArrowDown', true, { x: 100, y: 150 }],
    ['ArrowUp', true, { x: 100, y: 50 }],
  ])('%s large=%s', (key, large, expected) => {
    expect(movePane(from, key, large)).toEqual(expected);
  });

  it('clamps x at 10 and y at 50', () => {
    expect(movePane({ x: 15, y: 100 }, 'ArrowLeft', false)).toEqual({ x: 10, y: 100 });
    expect(movePane({ x: 100, y: 55 }, 'ArrowUp', true)).toEqual({ x: 100, y: 50 });
  });

  it('has no upper bound', () => {
    expect(movePane({ x: 5000, y: 5000 }, 'ArrowRight', true)).toEqual({ x: 5050, y: 5000 });
  });
});

describe('resizePane', () => {
  const from = { width: 600, height: 400 };
  it.each([
    ['ArrowRight', false, { width: 610, height: 400 }],
    ['ArrowLeft', false, { width: 590, height: 400 }],
    ['ArrowDown', false, { width: 600, height: 410 }],
    ['ArrowUp', false, { width: 600, height: 390 }],
    ['ArrowRight', true, { width: 650, height: 400 }],
    ['ArrowLeft', true, { width: 550, height: 400 }],
    ['ArrowDown', true, { width: 600, height: 450 }],
    ['ArrowUp', true, { width: 600, height: 350 }],
  ])('%s large=%s', (key, large, expected) => {
    expect(resizePane(from, key, large)).toEqual(expected);
  });

  it('clamps at 300 x 200', () => {
    expect(resizePane({ width: 305, height: 400 }, 'ArrowLeft', false)).toEqual({ width: 300, height: 400 });
    expect(resizePane({ width: 600, height: 210 }, 'ArrowUp', true)).toEqual({ width: 600, height: 200 });
  });
});
