import { describe, it, expect } from 'vitest';
import { agentStore } from '../agentStore';

describe('agentStore', () => {
  it('should initialize with default mock agents', () => {
    expect(agentStore.agents.length).toBeGreaterThan(0);
    expect(agentStore.activeAgentId).toBe('agent-1');
  });

  it('should support adding and removing agents', () => {
    const initialCount = agentStore.agents.length;
    
    agentStore.addAgent('Test Agent', 'tmux', 'localhost:test');
    expect(agentStore.agents.length).toBe(initialCount + 1);

    const added = agentStore.agents.find((a) => a.name === 'Test Agent');
    expect(added).toBeDefined();

    if (added) {
      agentStore.removeAgent(added.id);
      expect(agentStore.agents.length).toBe(initialCount);
    }
  });
});
