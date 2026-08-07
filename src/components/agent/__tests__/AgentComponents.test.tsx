import { describe, it, expect, beforeAll } from 'vitest';

describe('Agent components dynamic imports', () => {
  beforeAll(() => {
    if (typeof global.self === 'undefined') {
      (global as any).self = global;
    }
  });

  it('imports AgentControls dynamically', async () => {
    const { AgentControls } = await import('../AgentControls');
    expect(AgentControls).toBeDefined();
  });

  it('imports AgentPane dynamically', async () => {
    const { AgentPane } = await import('../AgentPane');
    expect(AgentPane).toBeDefined();
  });

  it('imports FloatingPane dynamically', async () => {
    const { FloatingPane } = await import('../../layout/FloatingPane');
    expect(FloatingPane).toBeDefined();
  });
});
