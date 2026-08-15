import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { discoverTmuxSessions } from '../TmuxDiscovery.js';

const customPromisifySymbol = Symbol.for('nodejs.util.promisify.custom');

vi.mock('child_process', () => {
  const customSymbol = Symbol.for('nodejs.util.promisify.custom');
  const mockExecFile = vi.fn();
  (mockExecFile as any)[customSymbol] = vi.fn();
  return {
    execFile: mockExecFile,
    default: {
      execFile: mockExecFile,
    },
  };
});

describe('TmuxDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return an array of discovered agents when tmux list-sessions returns sessions', async () => {
    const customExec = (execFile as any)[promisify.custom];
    customExec.mockResolvedValue({
      stdout: 'main\nagent-1\nagent-2\n',
      stderr: '',
    });

    const agents = await discoverTmuxSessions();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents).toHaveLength(3);
    expect(agents[0]).toMatchObject({
      id: 'tmux-main',
      name: 'Tmux: main',
      mode: 'tmux',
      targetHost: 'localhost:main',
      status: 'running',
    });
    expect(agents[1]).toMatchObject({
      id: 'tmux-agent-1',
      name: 'Tmux: agent-1',
      mode: 'tmux',
      targetHost: 'localhost:agent-1',
      status: 'running',
    });
    expect(agents[2]).toMatchObject({
      id: 'tmux-agent-2',
      name: 'Tmux: agent-2',
      mode: 'tmux',
      targetHost: 'localhost:agent-2',
      status: 'running',
    });
  });

  it('should return empty array if tmux is not running or fails', async () => {
    const customExec = (execFile as any)[promisify.custom];
    customExec.mockRejectedValue(new Error('no server running on /tmp/tmux-1000/default'));

    const agents = await discoverTmuxSessions();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents).toEqual([]);
  });

  it('should filter out empty lines in tmux output', async () => {
    const customExec = (execFile as any)[promisify.custom];
    customExec.mockResolvedValue({
      stdout: '\n\nsession1\n\n',
      stderr: '',
    });

    const agents = await discoverTmuxSessions();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('tmux-session1');
  });
});
