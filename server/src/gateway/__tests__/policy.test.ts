import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OPERATIONS } from '../../protocol/wsProtocol.js';
import type { OperationSpec, WSMessageClient } from '../../protocol/wsProtocol.js';
import { AgentService } from '../../services/AgentService.js';
import { TmuxDriver } from '../../services/TmuxDriver.js';
import { SshDriver } from '../../services/SshDriver.js';
import { killTmuxSession } from '../../services/tmuxKill.js';
import { AgentApi } from '../dispatch.js';
import type { DispatchOutcome } from '../dispatch.js';
import { checkDestructivePolicy, destructiveRules } from '../policy.js';

vi.mock('../../services/TmuxDriver.js', () => ({ TmuxDriver: vi.fn() }));
vi.mock('../../services/SshDriver.js', () => ({ SshDriver: vi.fn() }));
vi.mock('../../services/tmuxKill.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/tmuxKill.js')>();
  return { ...actual, killTmuxSession: vi.fn() };
});

const killMock = killTmuxSession as unknown as ReturnType<typeof vi.fn>;

const CATALOG = OPERATIONS as unknown as Record<string, OperationSpec>;
const syntheticCatalog = (): Record<string, OperationSpec> => ({
  ...CATALOG,
  'agent.close': { ...CATALOG['agent.close'], destructive: true, confirmParam: 'confirm' },
});

describe('destructiveRules', () => {
  it('derives exactly one rule from the real catalog: agent.kill with confirm', () => {
    expect(destructiveRules()).toEqual([{ operation: 'agent.kill', confirmParam: 'confirm', field: 'killSession' }]);
  });

  it('follows the catalog: a second destructive operation gets a rule without any edit to policy.ts', () => {
    const rules = destructiveRules(syntheticCatalog());
    expect(rules.map((r) => r.operation).sort()).toEqual(['agent.close', 'agent.kill']);
  });

  it('names the operation in the message field when the ws discriminator does not select it', () => {
    const rule = destructiveRules(syntheticCatalog()).find((r) => r.operation === 'agent.close');
    expect(rule?.field).toBe('agent.close');
  });

  it('fails closed: a destructive operation without a confirmParam throws and names the operation', () => {
    const bad = { ...CATALOG, 'agent.update': { ...CATALOG['agent.update'], destructive: true } };
    expect(() => destructiveRules(bad)).toThrow(/agent\.update/);
  });

  it('fails closed on an empty confirmParam', () => {
    const bad = { ...CATALOG, 'agent.update': { ...CATALOG['agent.update'], destructive: true, confirmParam: '' } };
    expect(() => destructiveRules(bad)).toThrow(/agent\.update/);
  });

  it('returns an empty list for a catalog without destructive operations', () => {
    const none = { ...CATALOG, 'agent.kill': { ...CATALOG['agent.kill'], destructive: false } };
    expect(destructiveRules(none)).toEqual([]);
  });

  it('does not mutate the catalog it reads', () => {
    destructiveRules(syntheticCatalog());
    expect(CATALOG['agent.close'].destructive).toBe(false);
  });
});

describe('checkDestructivePolicy', () => {
  const rules = destructiveRules();
  let warn: any;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('is null for an operation without a rule, including agent.close', () => {
    expect(checkDestructivePolicy('agent.close', { agentId: 'a' }, rules)).toBeNull();
    expect(checkDestructivePolicy('agent.update', { agentId: 'a' }, rules)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('is null when the operation is unknown (hello, ping)', () => {
    expect(checkDestructivePolicy(null, {}, rules)).toBeNull();
  });

  it('is null when confirm is exactly true', () => {
    expect(checkDestructivePolicy('agent.kill', { agentId: 'a', confirm: true }, rules)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', undefined],
    ['false', false],
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['null', null],
    ['an object', {}],
  ])('refuses %s with a USAGE error', (_n, confirm) => {
    const params: Record<string, unknown> = { agentId: 'a1', killSession: true };
    if (confirm !== undefined) params.confirm = confirm;
    expect(checkDestructivePolicy('agent.kill', params, rules)).toEqual({
      code: 'USAGE',
      message: 'killSession requires confirm: true',
      retryable: false,
      agentId: 'a1',
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('copies the agent id only when it is a string of 1 to 128 characters', () => {
    expect(checkDestructivePolicy('agent.kill', { agentId: 'x'.repeat(128) }, rules)?.agentId).toHaveLength(128);
    expect(checkDestructivePolicy('agent.kill', { agentId: 'x'.repeat(129) }, rules)).not.toHaveProperty('agentId');
    expect(checkDestructivePolicy('agent.kill', { agentId: '' }, rules)).not.toHaveProperty('agentId');
    expect(checkDestructivePolicy('agent.kill', { agentId: 7 }, rules)).not.toHaveProperty('agentId');
    expect(checkDestructivePolicy('agent.kill', {}, rules)).not.toHaveProperty('agentId');
  });

  it('logs one line with the operation and an id truncated to 64 characters, never the full id', () => {
    const longId = 'z'.repeat(300);
    checkDestructivePolicy('agent.kill', { agentId: longId }, rules);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('agent.kill');
    expect(line).toContain('z'.repeat(64));
    expect(line).not.toContain('z'.repeat(65));
  });

  it('enforces whatever rules it is given, not the word kill', () => {
    const synthetic = destructiveRules(syntheticCatalog());
    expect(checkDestructivePolicy('agent.close', { agentId: 'a' }, synthetic)?.code).toBe('USAGE');
    expect(checkDestructivePolicy('agent.close', { agentId: 'a', confirm: true }, synthetic)).toBeNull();
    expect(checkDestructivePolicy('agent.kill', { agentId: 'a' }, [])).toBeNull();
  });
});

describe('AgentApi policy stage', () => {
  let service: AgentService;
  let published: unknown[];
  let drivers: Array<{ write: unknown; resize: unknown; close: ReturnType<typeof vi.fn> }>;
  const spies: Array<{ mockRestore: () => void }> = [];
  let warn: any;

  const run = (api: AgentApi, msg: Record<string, unknown>): Promise<DispatchOutcome> =>
    api.execute(msg as WSMessageClient);

  async function made(api: AgentApi, host = 'h:qa_a') {
    const out = await run(api, { type: 'agent:create', name: 'a', mode: 'tmux', targetHost: host });
    if (!out.ok || !out.ack?.agent) throw new Error('create failed');
    return out.ack.agent;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    drivers = [];
    published = [];
    killMock.mockReset();
    killMock.mockResolvedValue('killed');
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spies.push(warn);
    for (const m of ['error', 'log'] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
    (TmuxDriver as any).mockImplementation(function () {
      const d = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
      drivers.push(d);
      return d;
    });
    (SshDriver as any).mockImplementation(function () {
      const d = { write: vi.fn(), resize: vi.fn(), close: vi.fn() };
      drivers.push(d);
      return d;
    });
    service = new AgentService((m) => published.push(m));
  });
  afterEach(() => {
    while (spies.length) spies.pop()!.mockRestore();
  });

  it.each([
    ['absent', undefined],
    ['false', false],
  ])('refuses a kill with confirm %s before the service: nothing is called', async (_n, confirm) => {
    const api = new AgentApi(service);
    const a = await made(api);
    const destroy = vi.spyOn(service, 'destroy');
    const close = vi.spyOn(service, 'close');
    warn.mockClear();
    const msg: Record<string, unknown> = { type: 'agent:kill', agentId: a.id, killSession: true, reqId: 'r-1' };
    if (confirm !== undefined) msg.confirm = confirm;
    const out = await run(api, msg);
    expect(out).toMatchObject({ ok: false, error: { code: 'USAGE', agentId: a.id } });
    expect(destroy).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(killMock).not.toHaveBeenCalled();
    expect(drivers[0].close).not.toHaveBeenCalled();
    expect(service.count()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not cache a refusal even when a reqId is present', async () => {
    const api = new AgentApi(service);
    const a = await made(api);
    const msg = { type: 'agent:kill', agentId: a.id, killSession: true, reqId: 'r-cache' };
    await run(api, msg);
    const run2 = vi.spyOn(api.cache, 'run');
    await run(api, { ...msg, confirm: true });
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(run2).toHaveBeenCalledTimes(1);
    expect(service.count()).toBe(0);
  });

  it('refuses an unknown agent id with USAGE, not NOT_FOUND: the gate precedes the lookup', async () => {
    const api = new AgentApi(service);
    const out = await run(api, { type: 'agent:kill', agentId: 'ghost', killSession: true });
    expect(out).toMatchObject({ ok: false, error: { code: 'USAGE' } });
    const confirmed = await run(api, { type: 'agent:kill', agentId: 'ghost', killSession: true, confirm: true });
    expect(confirmed).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('logs one warning without the full 300-character id', async () => {
    const api = new AgentApi(service);
    const longId = 'q'.repeat(300);
    await run(api, { type: 'agent:kill', agentId: longId, killSession: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('q'.repeat(65));
  });

  it('proceeds to the service when confirm is true', async () => {
    const api = new AgentApi(service);
    const a = await made(api);
    const out = await run(api, { type: 'agent:kill', agentId: a.id, killSession: true, confirm: true });
    expect(out).toEqual({ ok: true, ack: { op: 'kill' } });
    expect(killMock).toHaveBeenCalledWith('qa_a');
  });

  it('never consults the policy outcome for a plain close', async () => {
    const api = new AgentApi(service);
    const a = await made(api);
    const out = await run(api, { type: 'agent:kill', agentId: a.id });
    expect(out).toEqual({ ok: true, ack: { op: 'kill' } });
    expect(killMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('follows injected rules: with agent.close marked destructive a plain close needs confirm', async () => {
    const api = new AgentApi(service, { rules: destructiveRules(syntheticCatalog()) });
    const a = await made(api);
    const refused = await run(api, { type: 'agent:kill', agentId: a.id });
    expect(refused).toMatchObject({ ok: false, error: { code: 'USAGE', agentId: a.id } });
    expect(service.count()).toBe(1);
    const ok = await run(api, { type: 'agent:kill', agentId: a.id, confirm: true });
    expect(ok).toEqual({ ok: true, ack: { op: 'kill' } });
    expect(service.count()).toBe(0);
  });

  it('with no rules injected the catalog rules apply by default', async () => {
    const api = new AgentApi(service);
    const a = await made(api);
    const out = await run(api, { type: 'agent:kill', agentId: a.id, killSession: true });
    expect(out.ok).toBe(false);
  });

  it('keeps the service gate as defense in depth: a direct destroy without confirm is refused', async () => {
    const api = new AgentApi(service);
    const a = await made(api);
    const result = await service.destroy(a.id, {});
    expect(result).toMatchObject({ ok: false, error: { code: 'USAGE' } });
    expect(killMock).not.toHaveBeenCalled();
    expect(service.count()).toBe(1);
  });
});
