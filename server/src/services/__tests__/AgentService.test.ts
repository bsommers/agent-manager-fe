import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as tmuxDiscovery from '../TmuxDiscovery.js';
import { AgentService } from '../AgentService.js';
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

describe('AgentService', () => {
  let svc: AgentService;
  let tmuxDrivers: FakeDriver[];
  let sshDrivers: FakeDriver[];
  let published: any[];
  let warn: any;
  let error: any;
  let log: any;

  const snapshots = () => published.filter((f) => f.type === 'agent:init_list');
  const statusChanges = () => published.filter((f) => f.type === 'agent:status_change');
  const mkTmux = (): FakeDriver => ({ write: vi.fn(), resize: vi.fn(), close: vi.fn(), onExit: () => {} });

  function created(name = 'a', mode: 'tmux' | 'ssh' = 'tmux', host = 'localhost:qa_a'): Agent {
    const r = svc.create({ name, mode, targetHost: host });
    if (!r.ok) throw new Error('create failed');
    published.length = 0;
    return r.value;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    tmuxDrivers = [];
    sshDrivers = [];
    published = [];
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
      const d: FakeDriver = { ...mkTmux(), onExit };
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
      const d: FakeDriver = { ...mkTmux(), onExit };
      sshDrivers.push(d);
      return d;
    });

    svc = new AgentService((m) => published.push(m));
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
    error.mockRestore();
    log.mockRestore();
  });

  describe('create', () => {
    it('creates a tmux agent, registers it and publishes one snapshot containing it', () => {
      const r = svc.create({ name: 'a', mode: 'tmux', targetHost: 'localhost:qa_a' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value).toMatchObject({
        name: 'a',
        mode: 'tmux',
        targetHost: 'localhost:qa_a',
        status: 'running',
        layout: { isFloating: false },
      });
      expect(r.value.id).toMatch(/^agent-\d+-[a-z0-9]{1,4}$/);
      expect(typeof r.value.createdAt).toBe('number');
      expect(typeof r.value.lastActivity).toBe('number');
      expect(svc.get(r.value.id)).toBe(r.value);
      expect(svc.count()).toBe(1);
      expect(svc.list()).toEqual([r.value]);
      expect(svc.driverOf(r.value.id)).toBe(tmuxDrivers[0]);
      expect(snapshots()).toHaveLength(1);
      expect(snapshots()[0].agents).toEqual([r.value]);
      expect(published).toHaveLength(1);
    });

    it('creates an ssh agent with an ssh driver', () => {
      const r = svc.create({ name: 's', mode: 'ssh', targetHost: 'user@host' });
      expect(r.ok).toBe(true);
      expect(sshDrivers).toHaveLength(1);
      expect(tmuxDrivers).toHaveLength(0);
    });

    it('writes initialCmd plus a newline to the driver after 500 ms', () => {
      vi.useFakeTimers();
      const r = svc.create({ name: 'a', mode: 'tmux', targetHost: 'qa_a', initialCmd: 'ls' });
      expect(r.ok).toBe(true);
      expect(tmuxDrivers[0].write).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(tmuxDrivers[0].write).toHaveBeenCalledWith('ls\n');
    });

    it('swallows an initialCmd write that throws on a closed driver', () => {
      vi.useFakeTimers();
      svc.create({ name: 'a', mode: 'tmux', targetHost: 'qa_a', initialCmd: 'ls' });
      tmuxDrivers[0].write.mockImplementation(() => {
        throw new Error('closed');
      });
      expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    });
  });

  describe('initialize', () => {
    it('registers discovered sessions and attaches a driver to each', async () => {
      const discovered: Agent[] = ['x', 'y'].map((n) => ({
        id: `tmux-${n}`,
        name: n,
        mode: 'tmux',
        targetHost: `localhost:${n}`,
        status: 'running',
        unreadOutput: false,
        layout: { isFloating: false },
        createdAt: 1,
        lastActivity: 1,
      }));
      const spy = vi.spyOn(tmuxDiscovery, 'discoverTmuxSessions').mockResolvedValue(discovered);
      await svc.initialize();
      spy.mockRestore();
      expect(svc.count()).toBe(2);
      expect(tmuxDrivers).toHaveLength(2);
      expect(svc.driverOf('tmux-x')).toBe(tmuxDrivers[0]);
    });
  });

  describe('close', () => {
    it('closes the driver, removes the agent and publishes one snapshot without it', () => {
      const a = created();
      const r = svc.close(a.id);
      expect(r.ok).toBe(true);
      expect(tmuxDrivers[0].close).toHaveBeenCalledTimes(1);
      expect(svc.get(a.id)).toBeUndefined();
      expect(svc.driverOf(a.id)).toBeUndefined();
      expect(snapshots()).toHaveLength(1);
      expect(snapshots()[0].agents).toEqual([]);
      expect(killMock).not.toHaveBeenCalled();
    });

    it('swallows a driver close that throws', () => {
      const a = created();
      tmuxDrivers[0].close.mockImplementation(() => {
        throw new Error('boom');
      });
      expect(svc.close(a.id).ok).toBe(true);
      expect(svc.count()).toBe(0);
    });

    it('answers an unknown id with NOT_FOUND carrying the id, publishing and constructing nothing', () => {
      const r = svc.close('nope');
      expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', agentId: 'nope' } });
      expect(published).toEqual([]);
      expect(TmuxDriver).not.toHaveBeenCalled();
    });
  });

  describe('input and resize', () => {
    it('forwards to the driver of a known agent', () => {
      const a = created();
      expect(svc.input(a.id, 'x').ok).toBe(true);
      expect(svc.resize(a.id, 100, 30).ok).toBe(true);
      expect(tmuxDrivers[0].write).toHaveBeenCalledWith('x');
      expect(tmuxDrivers[0].resize).toHaveBeenCalledWith(100, 30);
    });

    it('lazily attaches a driver to a discovered tmux agent', async () => {
      const agent: Agent = {
        id: 'd1',
        name: 'd',
        mode: 'tmux',
        targetHost: 'qa_d',
        status: 'running',
        unreadOutput: false,
        layout: { isFloating: false },
        createdAt: 1,
        lastActivity: 1,
      };
      const spy = vi.spyOn(tmuxDiscovery, 'discoverTmuxSessions').mockResolvedValue([agent]);
      await svc.initialize();
      spy.mockRestore();
      // drop the driver created on initialize to prove the lazy path
      (svc as any).drivers.delete('d1');
      tmuxDrivers.length = 0;
      expect(svc.input('d1', 'q').ok).toBe(true);
      expect(tmuxDrivers).toHaveLength(1);
      expect(tmuxDrivers[0].write).toHaveBeenCalledWith('q');
    });

    it('answers an unknown id with NOT_FOUND and constructs nothing', () => {
      expect(svc.input('nope', 'x')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(svc.resize('nope', 1, 1)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(TmuxDriver).not.toHaveBeenCalled();
      expect(SshDriver).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('ends the derived session once, closes the driver, removes the agent, one snapshot and one audit line', async () => {
      const a = created();
      const r = await svc.destroy(a.id, { confirm: true });
      expect(r.ok).toBe(true);
      expect(killMock).toHaveBeenCalledTimes(1);
      expect(killMock).toHaveBeenCalledWith('qa_a');
      expect(tmuxDrivers[0].close).toHaveBeenCalledTimes(1);
      expect(svc.get(a.id)).toBeUndefined();
      expect(snapshots()).toHaveLength(1);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain('qa_a');
      expect(String(log.mock.calls[0][0])).toContain(a.id);
    });

    it('treats an already-gone session as success', async () => {
      const a = created();
      killMock.mockResolvedValue('already_gone');
      expect((await svc.destroy(a.id, { confirm: true })).ok).toBe(true);
      expect(svc.get(a.id)).toBeUndefined();
    });

    it.each([
      ['absent', undefined],
      ['false', false],
      ['the string "true"', 'true'],
      ['the number 1', 1],
    ])('the confirm gate refuses when confirm is %s, with no handler involved', async (_l, confirm) => {
      const a = created();
      const r = await svc.destroy(a.id, { confirm });
      expect(r).toMatchObject({
        ok: false,
        error: { code: 'USAGE', message: 'killSession requires confirm: true', agentId: a.id },
      });
      expect(killMock).not.toHaveBeenCalled();
      expect(tmuxDrivers[0].close).not.toHaveBeenCalled();
      expect(published).toEqual([]);
      expect(svc.get(a.id)).toBe(a);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(`agent:kill killSession refused (USAGE) for agent ${a.id}`);
    });

    it('the gate runs before the registry lookup (unknown id) and before the mode check (ssh agent)', async () => {
      const ssh = created('s', 'ssh', 'user@host');
      for (const id of ['nope', ssh.id]) {
        const r = await svc.destroy(id, {});
        expect(r).toMatchObject({ ok: false, error: { code: 'USAGE' } });
      }
      expect(killMock).not.toHaveBeenCalled();
      expect(sshDrivers[0].close).not.toHaveBeenCalled();
      expect(published).toEqual([]);
    });

    it('answers an unknown id with NOT_FOUND without calling tmux', async () => {
      const r = await svc.destroy('nope', { confirm: true });
      expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', agentId: 'nope' } });
      expect(killMock).not.toHaveBeenCalled();
      expect(published).toEqual([]);
    });

    it('refuses an ssh agent with UNSUPPORTED', async () => {
      const ssh = created('s', 'ssh', 'user@host');
      const r = await svc.destroy(ssh.id, { confirm: true });
      expect(r).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
      expect(killMock).not.toHaveBeenCalled();
      expect(svc.get(ssh.id)).toBe(ssh);
    });

    it('refuses a session name that is not killable with USAGE', async () => {
      const a = created('h', 'tmux', 'localhost:-bad name');
      const r = await svc.destroy(a.id, { confirm: true });
      expect(r).toMatchObject({
        ok: false,
        error: { code: 'USAGE', message: 'the session name cannot be killed by the gateway' },
      });
      expect(killMock).not.toHaveBeenCalled();
    });

    it('a tmux rejection returns INTERNAL with the fixed text and leaves everything untouched', async () => {
      const a = created();
      killMock.mockRejectedValue(new Error('secret stderr /etc/x'));
      const r = await svc.destroy(a.id, { confirm: true });
      expect(r).toMatchObject({ ok: false, error: { code: 'INTERNAL', message: 'tmux could not end the session' } });
      if (!r.ok) expect(JSON.stringify(r.error)).not.toContain('secret');
      expect(svc.get(a.id)).toBe(a);
      expect(tmuxDrivers[0].close).not.toHaveBeenCalled();
      expect(published).toEqual([]);
      expect(error).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('replays a driver exit that arrived during a failed kill as one status_change', async () => {
      const a = created();
      const d = deferred<'killed'>();
      killMock.mockReturnValue(d.promise);
      const p = svc.destroy(a.id, { confirm: true });
      tmuxDrivers[0].onExit();
      expect(statusChanges()).toHaveLength(0);
      d.reject(new Error('nope'));
      await p;
      expect(statusChanges()).toHaveLength(1);
      expect(a.status).toBe('disconnected');
    });

    it('two overlapping destroys call tmux once and resolve to the same result', async () => {
      const a = created();
      const d = deferred<'killed'>();
      killMock.mockReturnValue(d.promise);
      const p1 = svc.destroy(a.id, { confirm: true });
      const p2 = svc.destroy(a.id, { confirm: true });
      d.resolve('killed');
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(killMock).toHaveBeenCalledTimes(1);
      expect(r1).toBe(r2);
      expect(r1.ok).toBe(true);
      expect(snapshots()).toHaveLength(1);
    });

    it('a driver exit during a successful kill is dropped (no status_change)', async () => {
      const a = created();
      const d = deferred<'killed'>();
      killMock.mockReturnValue(d.promise);
      const p = svc.destroy(a.id, { confirm: true });
      tmuxDrivers[0].onExit();
      d.resolve('killed');
      await p;
      expect(statusChanges()).toHaveLength(0);
    });
  });

  describe('driver exit', () => {
    it('sets disconnected and publishes one status_change for a registered agent', () => {
      const a = created();
      tmuxDrivers[0].onExit();
      expect(a.status).toBe('disconnected');
      expect(statusChanges()).toEqual([{ type: 'agent:status_change', agentId: a.id, status: 'disconnected' }]);
    });

    it('does nothing for an agent no longer in the registry', () => {
      const a = created();
      svc.close(a.id);
      published.length = 0;
      tmuxDrivers[0].onExit();
      expect(published).toEqual([]);
    });
  });
});
