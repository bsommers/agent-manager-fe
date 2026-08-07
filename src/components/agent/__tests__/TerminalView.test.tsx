import { describe, it, expect, beforeAll } from 'vitest';

describe('TerminalView Component', () => {
  beforeAll(() => {
    if (typeof global.self === 'undefined') {
      (global as any).self = global;
    }
  });

  it('imports TerminalView dynamically', async () => {
    if (typeof global.self === 'undefined') {
      (global as any).self = global;
    }
    const { TerminalView } = await import('../TerminalView');
    expect(TerminalView).toBeDefined();
  });
});
