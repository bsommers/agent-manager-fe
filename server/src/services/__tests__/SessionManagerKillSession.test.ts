import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { parseServerMessage } from '@agent-manager/protocol';
import { SessionManager } from '../SessionManager.js';
import * as tmuxDiscovery from '../TmuxDiscovery.js';
import { TmuxDriver } from '../TmuxDriver.js';
import { SshDriver } from '../SshDriver.js';
import { killTmuxSession } from '../tmuxKill.js';
import type { Agent } from '../../protocol/wsProtocol.js';

vi.mock('../TmuxDriver.js', () => ({ TmuxDriver: vi.fn() }));
vi.mock('../SshDriver.js', () => ({ SshDriver: vi.fn() }));
vi.mock('../tmuxKill.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tmuxKill.js')>();
  return { ...actual, killTmuxSession: vi.fn() };
});

const killMock = killTmuxSession as unknown as ReturnType<typeof vi.fn>;

interface FakeDriver {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onExit: () => void;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SessionManager killSession', () => {
  let manager: SessionManager;
  let tmuxDrivers: FakeDriver[];
  let sshDrivers: FakeDriver[];
  let sent: any[];
  let reply: ReturnType<typeof vi.fn>;
  let warn: any;
  let error: any;
  let log: any;

  const replies = () => reply.mock.calls.map((c) => c[0]);
  const snapshots = () => sent.filter((f) => f.type === 'agent:init_list');
  const removed = () => sent.filter((f) => f.type === 'agent:removed');
  const statusChanges = () => sent.filter((f) => f.type === 'agent:status_change');
  const kill = (msg: Record<string, unknown>, r: any = reply) =>
    manager.handleClientMessage({ type: 'agent:kill', ...msg } as any, r);
  const settle = () => new Promise<void>((r) => setImmediate(r));

  beforeEach(() => {
    vi.clearAllMocks();
    tmuxDrivers = [];
    sshDrivers = [];
    sent = [];
    reply = vi.fn();
    killMock.mockReset();
    killMock.mockResolvedValue('killed');
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    log = vi.spyOn(console, 'log').mockImplementation(() => {});

    (TmuxDriver as any).mockImplementation(function (
      _s: string,
      _c: number,
      _r: number,
      _onData: unknown,
      onExit: () => void
    ) {
      const d: FakeDriver = { write: vi.fn(), resize: vi.fn(), close: vi.fn(), onExit };
      tmuxDrivers.push(d);
      return d;
    });
    (SshDriver as any).mockImplementation(function (
      _h: string,
      _c: number,
      _r: number,
      _onData: unknown,
      onExit: () => void
    ) {
      const d: FakeDriver = { write: vi.fn(), resize: vi.fn(), close: vi.fn(), onExit };
      sshDrivers.push(d);
      return d;
    });

    manager = new SessionManager();
    const ws: any = { send: vi.fn((s: string) => sent.push(JSON.parse(s))), readyState: WebSocket.OPEN };
    manager.addClient(ws);
    sent.length = 0; // drop the initial snapshot
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
    log.mockRestore();
  });

  describe('confirmed kill', () => {
    it('ends the derived session once, then closes the driver, removes the agent, one agent:removed, no reply', async () => {
      const a = manager.createAgent('a', 'tmux', 'localhost:qa_a');
      sent.length = 0;

      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();

      expect(killMock).toHaveBeenCalledTimes(1);
      expect(killMock).toHaveBeenCalledWith('qa_a');
      expect(tmuxDrivers[0].close).toHaveBeenCalledTimes(1);
      expect(manager.getAgent(a.id)).toBeUndefined();
      expect(removed()).toEqual([{ type: 'agent:removed', agentId: a.id, reason: 'killed' }]);
      expect(snapshots()).toHaveLength(0);
      expect(reply).not.toHaveBeenCalled();
    });

    it('treats an already-gone session as success', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      sent.length = 0;
      killMock.mockResolvedValue('already_gone');

      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();

      expect(manager.getAgent(a.id)).toBeUndefined();
      expect(removed()).toHaveLength(1);
      expect(reply).not.toHaveBeenCalled();
    });

    it('can kill a discovered agent by its derived name', async () => {
      const discovered: Agent = {
        id: 'tmux-qa-x',
        name: 'Tmux: qa-x',
        mode: 'tmux',
        targetHost: 'localhost:qa-x',
        status: 'running',
        unreadOutput: false,
        layout: { isFloating: false },
        createdAt: 1,
        lastActivity: 1,
      };
      vi.spyOn(tmuxDiscovery, 'discoverTmuxSessions').mockResolvedValueOnce([discovered]);
      await manager.initialize();
      sent.length = 0;

      kill({ agentId: 'tmux-qa-x', killSession: true, confirm: true });
      await settle();

      expect(killMock).toHaveBeenCalledWith('qa-x');
      expect(manager.getAgent('tmux-qa-x')).toBeUndefined();
    });

    it('logs one audit line naming the session and the agent', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain('qa_a');
      expect(String(log.mock.calls[0][0])).toContain(a.id);
    });
  });

  describe('the confirm gate', () => {
    it.each([
      ['absent', undefined],
      ['false', false],
      ['the string "true"', 'true'],
      ['the number 1', 1],
    ])('refuses with one USAGE reply and runs nothing when confirm is %s', async (_n, confirm) => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      sent.length = 0;
      const msg: Record<string, unknown> = { agentId: a.id, killSession: true };
      if (confirm !== undefined) msg.confirm = confirm;

      kill(msg);
      await settle();

      expect(replies()).toHaveLength(1);
      expect(replies()[0]).toMatchObject({
        type: 'agent:error',
        code: 'USAGE',
        retryable: false,
        agentId: a.id,
      });
      expect(killMock).not.toHaveBeenCalled();
      expect(tmuxDrivers[0].close).not.toHaveBeenCalled();
      expect(manager.getAgent(a.id)).toBe(a);
      expect(manager.getDriver(a.id)).toBe(tmuxDrivers[0]);
      expect(sent).toEqual([]);
    });

    it('wins over the unknown-agent check', async () => {
      kill({ agentId: 'ghost', killSession: true });
      await settle();
      expect(replies()).toHaveLength(1);
      expect(replies()[0].code).toBe('USAGE');
      expect(sent).toEqual([]);
      expect(killMock).not.toHaveBeenCalled();
    });

    it('wins over the ssh check', async () => {
      const s = manager.createAgent('s', 'ssh', 'host');
      sent.length = 0;
      kill({ agentId: s.id, killSession: true });
      await settle();
      expect(replies()).toHaveLength(1);
      expect(replies()[0].code).toBe('USAGE');
      expect(manager.getAgent(s.id)).toBe(s);
      expect(sent).toEqual([]);
    });

    it('wins over the name check', async () => {
      const a = manager.createAgent('a', 'tmux', 'a b');
      sent.length = 0;
      kill({ agentId: a.id, killSession: true });
      await settle();
      expect(replies()).toHaveLength(1);
      expect(replies()[0].code).toBe('USAGE');
      expect(replies()[0].message).toBe('killSession requires confirm: true');
    });

    it('without a reply callback only logs and still runs nothing', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      sent.length = 0;
      manager.handleClientMessage({ type: 'agent:kill', agentId: a.id, killSession: true } as any);
      await settle();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(killMock).not.toHaveBeenCalled();
      expect(manager.getAgent(a.id)).toBe(a);
      expect(sent).toEqual([]);
    });

    it('survives a reply callback that throws', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      const throwing = vi.fn(() => {
        throw new Error('socket closed');
      });
      expect(() => kill({ agentId: a.id, killSession: true }, throwing)).not.toThrow();
      await settle();
      expect(throwing).toHaveBeenCalledTimes(1);
    });
  });

  describe('plain close is unchanged', () => {
    it.each([
      ['absent', {}],
      ['false', { killSession: false }],
      ['the string "true"', { killSession: 'true' }],
      ['the number 1', { killSession: 1 }],
      ['undefined', { killSession: undefined }],
      ['confirm true without killSession', { confirm: true }],
    ])('killSession %s never calls tmux and closes the agent', async (_n, extra) => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      sent.length = 0;

      kill({ agentId: a.id, ...extra });
      await settle();

      expect(killMock).not.toHaveBeenCalled();
      expect(tmuxDrivers[0].close).toHaveBeenCalledTimes(1);
      expect(manager.getAgent(a.id)).toBeUndefined();
      expect(removed()).toHaveLength(1);
      expect(reply).not.toHaveBeenCalled();
    });

    it('confirmed killSession for an unknown id calls no tmux and answers NOT_FOUND, no snapshot', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      sent.length = 0;
      kill({ agentId: 'ghost', killSession: true, confirm: true });
      await settle();
      expect(killMock).not.toHaveBeenCalled();
      expect(snapshots()).toHaveLength(0);
      expect(removed()).toHaveLength(0);
      expect(replies()).toHaveLength(1);
      expect(replies()[0]).toMatchObject({ type: 'agent:error', code: 'NOT_FOUND', agentId: 'ghost' });
      expect(manager.getAgent(a.id)).toBe(a);
    });
  });

  describe('typed refusals', () => {
    it('an ssh agent gets one UNSUPPORTED reply, no tmux, stays listed, no snapshot', async () => {
      const s = manager.createAgent('s', 'ssh', 'tmux:secret');
      sent.length = 0;
      kill({ agentId: s.id, killSession: true, confirm: true });
      await settle();
      expect(replies()).toHaveLength(1);
      expect(replies()[0]).toMatchObject({ code: 'UNSUPPORTED', retryable: false, agentId: s.id });
      expect(killMock).not.toHaveBeenCalled();
      expect(manager.getAgent(s.id)).toBe(s);
      expect(sshDrivers[0].close).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    });

    it.each([
      ['a space', 'host:a b'],
      ['command substitution', 'host:$(id)'],
      ['a leading hyphen', 'host:-t'],
      ['more than 64 characters', `host:${'x'.repeat(65)}`],
      ['an empty session part', 'host:'],
    ])('an unkillable derived name (%s) gets one USAGE reply and nothing else', async (_n, targetHost) => {
      const a = manager.createAgent('a', 'tmux', targetHost);
      sent.length = 0;
      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();
      expect(replies()).toHaveLength(1);
      expect(replies()[0]).toMatchObject({ code: 'USAGE', retryable: false, agentId: a.id });
      expect(killMock).not.toHaveBeenCalled();
      expect(manager.getAgent(a.id)).toBe(a);
      expect(manager.getDriver(a.id)).toBe(tmuxDrivers[0]);
      expect(tmuxDrivers[0].close).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    });

    it('every reply is a valid agent:error and leaks neither stderr nor the session name', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_secret');
      const bad = manager.createAgent('b', 'tmux', 'x:$(id)');
      const s = manager.createAgent('s', 'ssh', 'host');
      killMock.mockRejectedValue(Object.assign(new Error('tmux: boom'), { stderr: 'SECRET stderr text' }));

      kill({ agentId: a.id, killSession: true });
      kill({ agentId: a.id, killSession: true, confirm: true });
      kill({ agentId: bad.id, killSession: true, confirm: true });
      kill({ agentId: s.id, killSession: true, confirm: true });
      await settle();

      expect(replies()).toHaveLength(4);
      for (const r of replies()) {
        const parsed = parseServerMessage(r);
        expect(parsed.ok).toBe(true);
        expect(r.retryable).toBe(false);
        expect(r).not.toHaveProperty('reqId');
        const text = JSON.stringify(r);
        expect(text).not.toContain('SECRET');
        expect(text).not.toContain('qa_secret');
        expect(text).not.toContain('boom');
      }
    });

    it('does not echo an agent id longer than 128 characters but still refuses', async () => {
      const longId = 'z'.repeat(300);
      kill({ agentId: longId, killSession: true });
      await settle();
      expect(replies()).toHaveLength(1);
      expect(replies()[0]).not.toHaveProperty('agentId');
      expect(parseServerMessage(replies()[0]).ok).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toContain(longId);
    });

    it('logs exactly one line per refusal', async () => {
      const a = manager.createAgent('a', 'tmux', 'a b');
      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('tmux failure', () => {
    it('leaves agent, driver and roster unchanged, logs one error and replies INTERNAL with fixed text', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      sent.length = 0;
      killMock.mockRejectedValue(Object.assign(new Error('boom'), { stderr: 'permission denied' }));

      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();

      expect(replies()).toHaveLength(1);
      expect(replies()[0]).toMatchObject({
        type: 'agent:error',
        code: 'INTERNAL',
        retryable: false,
        agentId: a.id,
        message: 'tmux could not end the session',
      });
      expect(manager.getAgent(a.id)).toBe(a);
      expect(manager.getDriver(a.id)).toBe(tmuxDrivers[0]);
      expect(tmuxDrivers[0].close).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('a later request after a failure is evaluated normally', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      killMock.mockRejectedValueOnce(new Error('boom'));
      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();
      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();
      expect(killMock).toHaveBeenCalledTimes(2);
      expect(manager.getAgent(a.id)).toBeUndefined();
    });
  });

  describe('in-flight de-duplication', () => {
    it('two confirmed requests while the first is in flight call tmux once; a later one is evaluated normally', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      sent.length = 0;
      const d = deferred<'killed'>();
      killMock.mockReturnValueOnce(d.promise);

      kill({ agentId: a.id, killSession: true, confirm: true });
      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();
      expect(killMock).toHaveBeenCalledTimes(1);

      d.resolve('killed');
      await settle();
      expect(manager.getAgent(a.id)).toBeUndefined();
      expect(removed()).toHaveLength(1);

      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();
      expect(killMock).toHaveBeenCalledTimes(1); // now an unknown id: plain close, no tmux
    });
  });

  describe('driver exit race', () => {
    it('an exit during an in-flight kill broadcasts no status_change, also after success', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      sent.length = 0;
      const d = deferred<'killed'>();
      killMock.mockReturnValueOnce(d.promise);

      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();
      tmuxDrivers[0].onExit();
      expect(statusChanges()).toHaveLength(0);

      d.resolve('killed');
      await settle();
      expect(statusChanges()).toHaveLength(0);
      expect(manager.getAgent(a.id)).toBeUndefined();
    });

    it('if the kill then fails, exactly one disconnected status_change is replayed', async () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      sent.length = 0;
      const d = deferred<'killed'>();
      killMock.mockReturnValueOnce(d.promise);

      kill({ agentId: a.id, killSession: true, confirm: true });
      await settle();
      tmuxDrivers[0].onExit();
      d.reject(new Error('boom'));
      await settle();

      expect(statusChanges()).toEqual([
        { type: 'agent:status_change', agentId: a.id, status: 'disconnected' },
      ]);
      expect(manager.getAgent(a.id)?.status).toBe('disconnected');
    });

    it('a late exit after a plain kill broadcasts nothing', () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      kill({ agentId: a.id });
      sent.length = 0;
      tmuxDrivers[0].onExit();
      expect(statusChanges()).toHaveLength(0);
    });

    it('an exit of a registered agent still broadcasts status_change exactly as before', () => {
      const a = manager.createAgent('a', 'tmux', 'qa_a');
      sent.length = 0;
      tmuxDrivers[0].onExit();
      expect(statusChanges()).toEqual([
        { type: 'agent:status_change', agentId: a.id, status: 'disconnected' },
      ]);
      expect(a.status).toBe('disconnected');
    });

    it('an exit of a registered ssh agent still broadcasts status_change', () => {
      const s = manager.createAgent('s', 'ssh', 'host');
      sent.length = 0;
      sshDrivers[0].onExit();
      expect(statusChanges()).toHaveLength(1);
      expect(s.status).toBe('disconnected');
    });

    it('an exit of a lazily created discovered driver still broadcasts status_change', async () => {
      const discovered: Agent = {
        id: 'tmux-d',
        name: 'Tmux: d',
        mode: 'tmux',
        targetHost: 'localhost:d',
        status: 'running',
        unreadOutput: false,
        layout: { isFloating: false },
        createdAt: 1,
        lastActivity: 1,
      };
      vi.spyOn(tmuxDiscovery, 'discoverTmuxSessions').mockResolvedValueOnce([discovered]);
      await manager.initialize();
      sent.length = 0;
      tmuxDrivers[0].onExit();
      expect(statusChanges()).toEqual([
        { type: 'agent:status_change', agentId: 'tmux-d', status: 'disconnected' },
      ]);
    });
  });
});
