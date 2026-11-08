/**
 * Pure arrow-key move/resize maths for floating panes. Shared by the keyboard
 * and mouse paths so both enforce the same limits.
 */
export const PANE_STEP = 10;
export const PANE_STEP_LARGE = 50;
export const PANE_MIN_X = 10;
export const PANE_MIN_Y = 50;
export const PANE_MIN_WIDTH = 300;
export const PANE_MIN_HEIGHT = 200;

const ARROW_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

export function isArrowKey(key: string): boolean {
  return ARROW_KEYS.includes(key);
}

export function movePane(
  pos: { x: number; y: number },
  key: string,
  large: boolean
): { x: number; y: number } {
  const step = large ? PANE_STEP_LARGE : PANE_STEP;
  let { x, y } = pos;
  if (key === 'ArrowRight') x += step;
  else if (key === 'ArrowLeft') x -= step;
  else if (key === 'ArrowDown') y += step;
  else if (key === 'ArrowUp') y -= step;
  return { x: Math.max(PANE_MIN_X, x), y: Math.max(PANE_MIN_Y, y) };
}

export function resizePane(
  size: { width: number; height: number },
  key: string,
  large: boolean
): { width: number; height: number } {
  const step = large ? PANE_STEP_LARGE : PANE_STEP;
  let { width, height } = size;
  if (key === 'ArrowRight') width += step;
  else if (key === 'ArrowLeft') width -= step;
  else if (key === 'ArrowDown') height += step;
  else if (key === 'ArrowUp') height -= step;
  return { width: Math.max(PANE_MIN_WIDTH, width), height: Math.max(PANE_MIN_HEIGHT, height) };
}
