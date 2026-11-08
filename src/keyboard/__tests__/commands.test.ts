import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCommands, filterCommands, MAX_PALETTE_RESULTS, type Command } from '../commands';
import { useAgentStore } from '../../store/agentStore';
import { useUiStore, resetUiStore } from '../../store/uiStore';
import { agentSocket } from '../../services/agentSocket';
import type { Agent } from '../../types/agent';

const cmd = (id: string, title: string, keywords = ''): Command => ({ id, title, keywords, run: () => {} });

describe('filterCommands', () => {
  const list = [
    cmd('a', 'Layout: Grid', 'arrange tile'),
    cmd('b', 'Search agent output', 'global logs'),
    cmd('c', 'Go to build box', 'agent terminal'),
    cmd('d', 'Filter agents', 'search roster'),
  ];

  it('returns every command in order for an empty query', () => {
    expect(filterCommands(list, '').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterCommands(list, '   ').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('requires every token to appear in title plus keywords, case-insensitively', () => {
    expect(filterCommands(list, 'LAYOUT tile').map((c) => c.id)).toEqual(['a']);
    expect(filterCommands(list, 'layout nothing')).toEqual([]);
  });

  it('ranks title-prefix before title-substring before keyword-only, stable within a rank', () => {
    const ranked = filterCommands(list, 'search').map((c) => c.id);
    // prefix: b (Search agent output); keyword-only: d (Filter agents, keyword "search")
    expect(ranked).toEqual(['b', 'd']);
    const sub = [cmd('x', 'Go to agent', ''), cmd('y', 'Agent first', ''), cmd('z', 'Other', 'agent')];
    expect(filterCommands(sub, 'agent').map((c) => c.id)).toEqual(['y', 'x', 'z']);
  });

  it('keeps original order within a rank', () => {
    const same = [cmd('1', 'Go one', ''), cmd('2', 'Go two', ''), cmd('3', 'Go three', '')];
    expect(filterCommands(same, 'go').map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it('caps results at MAX_PALETTE_RESULTS', () => {
    expect(MAX_PALETTE_RESULTS).toBe(50);
    const many = Array.from({ length: 120 }, (_, i) => cmd(`c${i}`, `Go to ${i}`));
    expect(filterCommands(many, '')).toHaveLength(50);
    expect(filterCommands(many, 'go')).toHaveLength(50);
    expect(filterCommands(many, '', 5)).toHaveLength(5);
  });
});

describe('buildCommands', () => {
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

  beforeEach(() => {
    vi.restoreAllMocks();
    resetUiStore();
    useAgentStore.setState({
      agents: [mk('a1', 'Alpha'), mk('a2', 'Beta'), mk('a3', 'Gamma')],
      pending: {},
      activeAgentId: null,
      layoutMode: 'grid',
    });
  });

  it('returns the fixed commands in order, then one Go to row per agent', () => {
    expect(buildCommands().map((c) => c.title)).toEqual([
      'New agent',
      'Broadcast to agents',
      'Search agent output',
      'Filter agents',
      'Show keyboard shortcuts',
      'Layout: Grid',
      'Layout: Focus',
      'Layout: Cascade',
      'Go to Alpha',
      'Go to Beta',
      'Go to Gamma',
    ]);
  });

  it('has no Go to rows without agents and skips pending agents', () => {
    useAgentStore.setState({ agents: [], pending: {} });
    expect(buildCommands().some((c) => c.title.startsWith('Go to'))).toBe(false);

    useAgentStore.setState({
      agents: [mk('a1', 'Alpha'), mk('pending-1', 'Starting')],
      pending: { 'pending-1': { name: 'Starting', mode: 'tmux', targetHost: 'x', startedAt: 1 } },
    });
    const titles = buildCommands().map((c) => c.title);
    expect(titles).toContain('Go to Alpha');
    expect(titles).not.toContain('Go to Starting');
  });

  it('Go to activates the agent, raises it and requests terminal focus', () => {
    buildCommands()
      .find((c) => c.title === 'Go to Beta')!
      .run();
    expect(useAgentStore.getState().activeAgentId).toBe('a2');
    expect(useUiStore.getState().focusRequest.target).toBe('terminal:a2');
  });

  it('New agent, Search, Filter and Broadcast drive the UI store', () => {
    const by = (t: string) => buildCommands().find((c) => c.title === t)!;
    by('New agent').run();
    expect(useUiStore.getState().overlay).toBe('addAgent');
    by('Search agent output').run();
    expect(useUiStore.getState().overlay).toBe('search');
    by('Filter agents').run();
    expect(useUiStore.getState().focusRequest.target).toBe('agent-filter');
    by('Broadcast to agents').run();
    expect(useUiStore.getState().isBroadcastOpen).toBe(true);
    expect(useUiStore.getState().focusRequest.target).toBe('broadcast');
  });

  it('Show keyboard shortcuts opens the help overlay and shows the chord hint', () => {
    const help = buildCommands().find((c) => c.title === 'Show keyboard shortcuts')!;
    expect(help.hint).toBe('Ctrl+/');
    help.run();
    expect(useUiStore.getState().overlay).toBe('help');
  });

  it('layout commands call the arrange actions like the toolbar buttons', () => {
    const by = (t: string) => buildCommands().find((c) => c.title === t)!;
    by('Layout: Cascade').run();
    expect(useAgentStore.getState().layoutMode).toBe('cascade');
    by('Layout: Focus').run();
    expect(useAgentStore.getState().layoutMode).toBe('focus');
    by('Layout: Grid').run();
    expect(useAgentStore.getState().layoutMode).toBe('grid');
  });

  it('Search agent output shows the registry chord as its hint', () => {
    expect(buildCommands().find((c) => c.title === 'Search agent output')!.hint).toBe('Ctrl+Shift+F');
  });

  it('contains no destructive command: nothing is sent and no agent is removed', () => {
    const send = vi.spyOn(agentSocket, 'send');
    const removeAgent = vi.fn();
    useAgentStore.setState({ removeAgent });
    for (const c of buildCommands()) c.run();
    expect(send).not.toHaveBeenCalled();
    expect(removeAgent).not.toHaveBeenCalled();
    expect(useAgentStore.getState().agents).toHaveLength(3);
  });
});
