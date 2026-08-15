import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { SessionManager } from '../SessionManager.js';
import * as tmuxDiscovery from '../TmuxDiscovery.js';
import { TmuxDriver } from '../TmuxDriver.js';
import { SshDriver } from '../SshDriver.js';
import { Agent } from '../../protocol/wsProtocol.js';

vi.mock('../TmuxDriver.js', () => {
  const MockTmuxDriver = vi.fn();
  return {
    TmuxDriver: MockTmuxDriver,
  };
});

vi.mock('../SshDriver.js', () => {
  const MockSshDriver = vi.fn();
  return {
    SshDriver: MockSshDriver,
  };
});

describe('SessionManager', () => {
  let manager: SessionManager;
  let mockTmuxDriverInstance: any;
  let mockSshDriverInstance: any;
  let tmuxOnDataCb: ((data: string) => void) | undefined;
  let tmuxOnExitCb: ((code: number) => void) | undefined;
  let sshOnDataCb: ((data: string) => void) | undefined;
  let sshOnExitCb: (() => void) | undefined;
  let sshOnErrorCb: ((err: Error) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockTmuxDriverInstance = {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    };

    mockSshDriverInstance = {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    };

    (TmuxDriver as any).mockImplementation(
      (
        sessionName: string,
        cols: number,
        rows: number,
        onData: (data: string) => void,
        onExit: (code: number) => void
      ) => {
        tmuxOnDataCb = onData;
        tmuxOnExitCb = onExit;
        return mockTmuxDriverInstance;
      }
    );

    (SshDriver as any).mockImplementation(
      (
        targetHost: string,
        cols: number,
        rows: number,
        onData: (data: string) => void,
        onExit: () => void,
        onError: (err: Error) => void
      ) => {
        sshOnDataCb = onData;
        sshOnExitCb = onExit;
        sshOnErrorCb = onError;
        return mockSshDriverInstance;
      }
    );

    manager = new SessionManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialize', () => {
    it('should discover tmux sessions and populate agents map', async () => {
      const mockDiscovered: Agent[] = [
        {
          id: 'tmux-session-1',
          name: 'Tmux: session-1',
          mode: 'tmux',
          targetHost: 'localhost:session-1',
          status: 'running',
          unreadOutput: false,
          layout: { isFloating: false },
          createdAt: 1000,
          lastActivity: 1000,
        },
      ];

      vi.spyOn(tmuxDiscovery, 'discoverTmuxSessions').mockResolvedValueOnce(mockDiscovered);

      await manager.initialize();

      expect(manager.getAgentCount()).toBe(1);
      expect(manager.getAgent('tmux-session-1')).toEqual(mockDiscovered[0]);
    });

    it('should handle empty discovered sessions gracefully', async () => {
      vi.spyOn(tmuxDiscovery, 'discoverTmuxSessions').mockResolvedValueOnce([]);

      await manager.initialize();

      expect(manager.getAgentCount()).toBe(0);
    });
  });

  describe('client management and broadcast', () => {
    it('should add client and send initial agent list', () => {
      const mockWs: any = {
        send: vi.fn(),
        readyState: WebSocket.OPEN,
      };

      manager.addClient(mockWs);

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent).toEqual({
        type: 'agent:init_list',
        agents: [],
      });
    });

    it('should broadcast message to all connected and open clients', () => {
      const ws1: any = { send: vi.fn(), readyState: WebSocket.OPEN };
      const ws2: any = { send: vi.fn(), readyState: WebSocket.OPEN };
      const wsClosed: any = { send: vi.fn(), readyState: WebSocket.CLOSED };

      manager.addClient(ws1);
      manager.addClient(ws2);
      manager.addClient(wsClosed);

      // Clear the initial init_list calls
      ws1.send.mockClear();
      ws2.send.mockClear();
      wsClosed.send.mockClear();

      manager.broadcast({ type: 'agent:output', agentId: 'test-1', data: 'hello' });

      expect(ws1.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'agent:output', agentId: 'test-1', data: 'hello' })
      );
      expect(ws2.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'agent:output', agentId: 'test-1', data: 'hello' })
      );
      expect(wsClosed.send).not.toHaveBeenCalled();
    });

    it('should not broadcast to removed clients', () => {
      const ws1: any = { send: vi.fn(), readyState: WebSocket.OPEN };
      manager.addClient(ws1);
      manager.removeClient(ws1);

      ws1.send.mockClear();
      manager.broadcast({ type: 'agent:output', agentId: 'test-1', data: 'hello' });

      expect(ws1.send).not.toHaveBeenCalled();
    });
  });

  describe('createAgent', () => {
    it('should create tmux agent and spawn TmuxDriver', () => {
      const agent = manager.createAgent('My Tmux', 'tmux', 'localhost:my-tmux-session');

      expect(agent).toMatchObject({
        name: 'My Tmux',
        mode: 'tmux',
        targetHost: 'localhost:my-tmux-session',
        status: 'running',
      });
      expect(TmuxDriver).toHaveBeenCalledWith(
        'my-tmux-session',
        80,
        24,
        expect.any(Function),
        expect.any(Function)
      );
      expect(manager.getAgent(agent.id)).toBeDefined();
      expect(manager.getDriver(agent.id)).toBe(mockTmuxDriverInstance);
    });

    it('should handle targetHost without colon prefix for tmux mode', () => {
      manager.createAgent('Direct Tmux', 'tmux', 'plain-session');

      expect(TmuxDriver).toHaveBeenCalledWith(
        'plain-session',
        80,
        24,
        expect.any(Function),
        expect.any(Function)
      );
    });

    it('should create ssh agent and spawn SshDriver', () => {
      const agent = manager.createAgent('Remote Server', 'ssh', 'user@remote.host:2222');

      expect(agent).toMatchObject({
        name: 'Remote Server',
        mode: 'ssh',
        targetHost: 'user@remote.host:2222',
        status: 'running',
      });
      expect(SshDriver).toHaveBeenCalledWith(
        'user@remote.host:2222',
        80,
        24,
        expect.any(Function),
        expect.any(Function),
        expect.any(Function)
      );
      expect(manager.getAgent(agent.id)).toBeDefined();
      expect(manager.getDriver(agent.id)).toBe(mockSshDriverInstance);
    });

    it('should forward data from tmux driver to broadcast output and update lastActivity', () => {
      const mockWs: any = { send: vi.fn(), readyState: WebSocket.OPEN };
      manager.addClient(mockWs);

      const agent = manager.createAgent('Tmux Agent', 'tmux', 'test-session');
      const initialActivity = agent.lastActivity;

      mockWs.send.mockClear();
      vi.advanceTimersByTime(100);

      expect(tmuxOnDataCb).toBeDefined();
      tmuxOnDataCb!('output from tmux');

      expect(agent.lastActivity).toBeGreaterThanOrEqual(initialActivity + 100);
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'agent:output', agentId: agent.id, data: 'output from tmux' })
      );
    });

    it('should handle tmux onExit callback and broadcast status_change', () => {
      const mockWs: any = { send: vi.fn(), readyState: WebSocket.OPEN };
      manager.addClient(mockWs);

      const agent = manager.createAgent('Tmux Agent', 'tmux', 'test-session');
      mockWs.send.mockClear();

      expect(tmuxOnExitCb).toBeDefined();
      tmuxOnExitCb!(0);

      expect(agent.status).toBe('disconnected');
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'agent:status_change', agentId: agent.id, status: 'disconnected' })
      );
    });

    it('should handle ssh onError callback and broadcast status_change and error message', () => {
      const mockWs: any = { send: vi.fn(), readyState: WebSocket.OPEN };
      manager.addClient(mockWs);

      const agent = manager.createAgent('SSH Agent', 'ssh', 'bad.host');
      mockWs.send.mockClear();

      expect(sshOnErrorCb).toBeDefined();
      sshOnErrorCb!(new Error('Connection refused'));

      expect(agent.status).toBe('error');
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'agent:status_change', agentId: agent.id, status: 'error' })
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'agent:output',
          agentId: agent.id,
          data: '\r\n\x1b[31m[SSH Error] Connection refused\x1b[0m\r\n',
        })
      );
    });

    it('should handle ssh onExit callback and broadcast status_change', () => {
      const mockWs: any = { send: vi.fn(), readyState: WebSocket.OPEN };
      manager.addClient(mockWs);

      const agent = manager.createAgent('SSH Agent', 'ssh', 'host');
      mockWs.send.mockClear();

      expect(sshOnExitCb).toBeDefined();
      sshOnExitCb!();

      expect(agent.status).toBe('disconnected');
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'agent:status_change', agentId: agent.id, status: 'disconnected' })
      );
    });

    it('should send initialCmd after delay if provided', () => {
      manager.createAgent('Auto cmd', 'tmux', 'session', 'echo hello');

      expect(mockTmuxDriverInstance.write).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(mockTmuxDriverInstance.write).toHaveBeenCalledWith('echo hello\n');
    });
  });

  describe('handleClientMessage', () => {
    it('should route agent:create', () => {
      const spy = vi.spyOn(manager, 'createAgent');
      manager.handleClientMessage({
        type: 'agent:create',
        name: 'New Agent',
        mode: 'tmux',
        targetHost: 'host:name',
        initialCmd: 'htop',
      });

      expect(spy).toHaveBeenCalledWith('New Agent', 'tmux', 'host:name', 'htop');
    });

    it('should route agent:input', () => {
      const spy = vi.spyOn(manager, 'sendInput');
      manager.handleClientMessage({
        type: 'agent:input',
        agentId: 'agent-123',
        data: 'ls\r',
      });

      expect(spy).toHaveBeenCalledWith('agent-123', 'ls\r');
    });

    it('should route agent:resize', () => {
      const spy = vi.spyOn(manager, 'resizeSession');
      manager.handleClientMessage({
        type: 'agent:resize',
        agentId: 'agent-123',
        cols: 120,
        rows: 40,
      });

      expect(spy).toHaveBeenCalledWith('agent-123', 120, 40);
    });

    it('should route agent:kill', () => {
      const spy = vi.spyOn(manager, 'killAgent');
      manager.handleClientMessage({
        type: 'agent:kill',
        agentId: 'agent-123',
      });

      expect(spy).toHaveBeenCalledWith('agent-123');
    });
  });

  describe('sendInput & resizeSession', () => {
    it('should write data to existing driver', () => {
      const agent = manager.createAgent('Tmux', 'tmux', 'session');
      manager.sendInput(agent.id, 'command\n');

      expect(mockTmuxDriverInstance.write).toHaveBeenCalledWith('command\n');
    });

    it('should lazily create TmuxDriver for discovered session on input', async () => {
      vi.spyOn(tmuxDiscovery, 'discoverTmuxSessions').mockResolvedValueOnce([
        {
          id: 'tmux-discovered',
          name: 'Tmux: discovered',
          mode: 'tmux',
          targetHost: 'localhost:discovered',
          status: 'running',
          unreadOutput: false,
          layout: { isFloating: false },
          createdAt: Date.now(),
          lastActivity: Date.now(),
        },
      ]);

      await manager.initialize();
      manager.sendInput('tmux-discovered', 'whoami\n');

      expect(TmuxDriver).toHaveBeenCalledWith(
        'discovered',
        80,
        24,
        expect.any(Function),
        expect.any(Function)
      );
      expect(mockTmuxDriverInstance.write).toHaveBeenCalledWith('whoami\n');
    });

    it('should ignore sendInput if agent does not exist', () => {
      expect(() => manager.sendInput('non-existent', 'data')).not.toThrow();
    });

    it('should resize session for existing driver', () => {
      const agent = manager.createAgent('SSH', 'ssh', 'host');
      manager.resizeSession(agent.id, 100, 50);

      expect(mockSshDriverInstance.resize).toHaveBeenCalledWith(100, 50);
    });

    it('should lazily create TmuxDriver for discovered session on resize', async () => {
      vi.spyOn(tmuxDiscovery, 'discoverTmuxSessions').mockResolvedValueOnce([
        {
          id: 'tmux-disc',
          name: 'Tmux: disc',
          mode: 'tmux',
          targetHost: 'disc',
          status: 'running',
          unreadOutput: false,
          layout: { isFloating: false },
          createdAt: Date.now(),
          lastActivity: Date.now(),
        },
      ]);

      await manager.initialize();
      manager.resizeSession('tmux-disc', 110, 45);

      expect(TmuxDriver).toHaveBeenCalledWith(
        'disc',
        80,
        24,
        expect.any(Function),
        expect.any(Function)
      );
      expect(mockTmuxDriverInstance.resize).toHaveBeenCalledWith(110, 45);
    });

    it('should ignore resizeSession if agent does not exist', () => {
      expect(() => manager.resizeSession('non-existent', 80, 24)).not.toThrow();
    });
  });

  describe('killAgent', () => {
    it('should close driver, remove agent, and broadcast updated init list', () => {
      const mockWs: any = { send: vi.fn(), readyState: WebSocket.OPEN };
      manager.addClient(mockWs);

      const agent = manager.createAgent('Tmux', 'tmux', 'session');
      expect(manager.getAgentCount()).toBe(1);

      mockWs.send.mockClear();
      manager.killAgent(agent.id);

      expect(mockTmuxDriverInstance.close).toHaveBeenCalled();
      expect(manager.getAgentCount()).toBe(0);
      expect(manager.getAgent(agent.id)).toBeUndefined();
      expect(manager.getDriver(agent.id)).toBeUndefined();
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'agent:init_list', agents: [] })
      );
    });

    it('should handle killing non-existent agent gracefully', () => {
      expect(() => manager.killAgent('non-existent')).not.toThrow();
    });
  });

  describe('getAgents', () => {
    it('should return all agents as an array', () => {
      manager.createAgent('Agent 1', 'tmux', 's1');
      manager.createAgent('Agent 2', 'ssh', 's2');

      const agents = manager.getAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.name)).toEqual(['Agent 1', 'Agent 2']);
    });
  });
});
