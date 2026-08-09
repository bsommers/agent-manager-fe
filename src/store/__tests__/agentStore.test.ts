import { describe, it, expect } from 'vitest';
import { agentStore } from '../agentStore';

describe('agentStore', () => {
  it('should initialize with default mock agents', () => {
    expect(agentStore.agents.length).toBeGreaterThan(0);
    expect(agentStore.activeAgentId).toBe('agent-1');
    expect(agentStore.layoutMode).toBe('grid');
  });

  it('should support adding and removing agents', () => {
    const initialCount = agentStore.agents.length;

    agentStore.addAgent('Test Worker', 'tmux', 'localhost:test_session');
    expect(agentStore.agents.length).toBe(initialCount + 1);

    const added = agentStore.agents.find((a) => a.name === 'Test Worker');
    expect(added).toBeDefined();

    if (added) {
      agentStore.removeAgent(added.id);
      expect(agentStore.agents.length).toBe(initialCount);
    }
  });

  it('should toggle undock floating state and update position', () => {
    const targetAgentId = 'agent-1';
    const initialAgent = agentStore.agents.find((a) => a.id === targetAgentId);
    expect(initialAgent?.layout.isFloating).toBe(false);

    agentStore.toggleUndock(targetAgentId);
    let updatedAgent = agentStore.agents.find((a) => a.id === targetAgentId);
    expect(updatedAgent?.layout.isFloating).toBe(true);

    agentStore.updateFloatingPosition(targetAgentId, 300, 250);
    updatedAgent = agentStore.agents.find((a) => a.id === targetAgentId);
    expect(updatedAgent?.layout.x).toBe(300);
    expect(updatedAgent?.layout.y).toBe(250);

    // Re-dock
    agentStore.toggleUndock(targetAgentId);
    updatedAgent = agentStore.agents.find((a) => a.id === targetAgentId);
    expect(updatedAgent?.layout.isFloating).toBe(false);
  });

  it('should update layout mode and search query state', () => {
    agentStore.setLayoutMode('focus');
    expect(agentStore.layoutMode).toBe('focus');

    agentStore.setSearchQuery('prod');
    expect(agentStore.searchQuery).toBe('prod');

    // Reset
    agentStore.setLayoutMode('grid');
    agentStore.setSearchQuery('');
  });

  it('should elevate z-index on bringToFront', () => {
    const agentId = 'agent-2';
    agentStore.toggleUndock(agentId);
    agentStore.bringToFront(agentId);

    const agent = agentStore.agents.find((a) => a.id === agentId);
    expect(agent?.layout.zIndex).toBeGreaterThanOrEqual(100);
    expect(agentStore.activeAgentId).toBe(agentId);

    // Clean up
    agentStore.toggleUndock(agentId);
  });
});
