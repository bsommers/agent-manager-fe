import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Tests run against the explicit Demo adapter (simulated output).
vi.stubEnv('VITE_DEMO_MODE', '1');

// Global ResizeObserver mock for xterm and workspace layout testing
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Global matchMedia mock for xterm.js in jsdom environment
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Global HTMLCanvasElement getContext mock for xterm canvas rendering in jsdom
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as any;
}
