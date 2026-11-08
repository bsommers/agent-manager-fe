import { describe, it, expect, beforeEach } from 'vitest';
import { OPERATIONS, checkSurfaceCoverage, listOperations } from '@agent-manager/protocol';
import { buildCommands } from '../commands';
import { useAgentStore } from '../../store/agentStore';
import { resetUiStore } from '../../store/uiStore';
import type { Agent } from '../../types/agent';

const mk = (id: string, name: string): Agent => ({
  id,
  name,
  mode: 'tmux',
  targetHost: `host-${id}`,
  status: 'running',
  unreadOutput: false,
  layout: { isFloating: false },
  createdAt: 1,
  lastActivity: 1,
});

/** UI-only commands: no operation behind them. A new command must be added here deliberately. */
const UI_ONLY_ALLOWLIST = [/^filter\.focus$/, /^help\.open$/, /^layout\.(grid|focus|cascade)$/, /^agent\.goto\..+$/];

describe('palette versus operations catalog', () => {
  beforeEach(() => {
    resetUiStore();
    useAgentStore.setState({
      agents: [mk('a1', 'Alpha'), mk('a2', 'Beta'), mk('a3', 'Gamma')],
      pending: {},
      activeAgentId: null,
      layoutMode: 'grid',
    });
  });

  it('commands carrying an operation equal the catalog palette bindings (no missing, unknown or duplicate)', () => {
    const ids = buildCommands()
      .filter((c) => c.operation !== undefined)
      .map((c) => c.id);
    expect(checkSurfaceCoverage('palette', ids)).toEqual({ missing: [], unknown: [], duplicate: [] });
  });

  it('each operation command takes its id from the catalog palette binding', () => {
    const byOperation = buildCommands().filter((c) => c.operation !== undefined);
    expect(byOperation.map((c) => [c.operation, c.id])).toEqual([
      ['agent.create', 'agent.new'],
      ['agent.broadcast', 'broadcast.open'],
      ['search.query', 'search.open'],
    ]);
    for (const c of byOperation) {
      const binding = OPERATIONS[c.operation!].palette;
      expect('id' in binding && binding.id).toBe(c.id);
    }
  });

  it('every command without an operation matches the explicit allowlist', () => {
    const unlisted = buildCommands()
      .filter((c) => c.operation === undefined)
      .map((c) => c.id)
      .filter((id) => !UI_ONLY_ALLOWLIST.some((re) => re.test(id)));
    expect(unlisted).toEqual([]);
  });

  it('no palette command maps to a destructive operation (threat T-05-05)', () => {
    const destructive = listOperations()
      .filter(([, op]) => op.destructive)
      .map(([name]) => name);
    expect(destructive).toEqual(['agent.kill']);
    for (const c of buildCommands()) {
      if (c.operation !== undefined) expect(destructive).not.toContain(c.operation);
    }
  });

  it('Go to rows built from the roster carry no operation', () => {
    const goto = buildCommands().filter((c) => c.id.startsWith('agent.goto.'));
    expect(goto).toHaveLength(3);
    for (const c of goto) expect(c.operation).toBeUndefined();
  });
});
