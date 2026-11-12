import { describe, it, expect, vi, afterEach } from 'vitest';
import { CONTRACT_VERSION, LIMITS, parseServerMessage } from '../../protocol/wsProtocol.js';
import { createAuthGuard } from '../auth.js';
import {
  CLOSE_RATE_LIMITED,
  CLOSE_UNAUTHENTICATED,
  GATEWAY_CAPABILITIES,
  HELLO_TIMEOUT_MS,
  MAX_PREAUTH_FRAME_BYTES,
  UNAUTHENTICATED_REASON,
  buildHelloAck,
  checkHello,
} from '../handshake.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixtures: { name: string; message: Record<string, unknown> }[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../packages/protocol/fixtures/client.json', import.meta.url)), 'utf8')
);

const TOKEN = 'correct-horse-battery-staple-0123';
const guard = createAuthGuard(TOKEN);
const hello = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'hello', contract: CONTRACT_VERSION, token: TOKEN, ...extra });

describe('checkHello', () => {
  it('accepts a valid hello with the right token and carries the parsed message', () => {
    const v = checkHello(hello(), guard);
    expect(v.kind).toBe('ok');
    if (v.kind === 'ok') expect(v.hello.token).toBe(TOKEN);
  });

  it('accepts a hello with a different contract number (the gateway answers with its own)', () => {
    expect(checkHello(hello({ contract: 99 }), guard).kind).toBe('ok');
  });

  it('rejects a wrong token as bad_token', () => {
    expect(checkHello(hello({ token: TOKEN.slice(0, -1) + 'X' }), guard)).toEqual({ kind: 'reject', reason: 'bad_token' });
  });

  it('rejects a missing or empty token as missing_token', () => {
    const noToken = JSON.stringify({ type: 'hello', contract: 1 });
    expect(checkHello(noToken, guard)).toEqual({ kind: 'reject', reason: 'missing_token' });
    expect(checkHello(hello({ token: '' }), guard)).toEqual({ kind: 'reject', reason: 'missing_token' });
  });

  it('rejects any other well-formed type as not_hello', () => {
    expect(checkHello(JSON.stringify({ type: 'ping', t: 1 }), guard)).toEqual({ kind: 'reject', reason: 'not_hello' });
    expect(
      checkHello(JSON.stringify({ type: 'agent:create', name: 'a', mode: 'tmux', targetHost: 'h' }), guard)
    ).toEqual({ kind: 'reject', reason: 'not_hello' });
  });

  it('rejects non-JSON and non-object shapes as malformed', () => {
    for (const raw of ['not json', 'null', '42', '[1,2]', '{"no":"type"}', '{"type":5}', '']) {
      expect(checkHello(raw, guard)).toEqual({ kind: 'reject', reason: 'malformed' });
    }
  });

  it('rejects a hello the validator refuses as invalid_hello', () => {
    expect(checkHello(JSON.stringify({ type: 'hello', token: TOKEN }), guard)).toEqual({
      kind: 'reject',
      reason: 'invalid_hello',
    });
    expect(checkHello(hello({ token: 'x'.repeat(513) }), guard)).toEqual({ kind: 'reject', reason: 'invalid_hello' });
    expect(checkHello(hello({ token: `ab\u0001cd` }), guard)).toEqual({ kind: 'reject', reason: 'invalid_hello' });
  });

  it('rejects a frame over the cap as oversize, before JSON.parse', () => {
    const big = JSON.stringify({ type: 'hello', contract: 1, token: TOKEN, pad: 'x'.repeat(MAX_PREAUTH_FRAME_BYTES) });
    expect(Buffer.byteLength(big)).toBeGreaterThan(MAX_PREAUTH_FRAME_BYTES);
    expect(checkHello(big, guard)).toEqual({ kind: 'reject', reason: 'oversize' });
    const spy = vi.spyOn(JSON, 'parse');
    expect(checkHello('x'.repeat(20000), guard)).toEqual({ kind: 'reject', reason: 'oversize' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('measures the cap in UTF-8 bytes, not characters', () => {
    const multi = 'é'.repeat(MAX_PREAUTH_FRAME_BYTES / 2 + 1);
    expect(multi.length).toBeLessThanOrEqual(MAX_PREAUTH_FRAME_BYTES);
    expect(checkHello(multi, guard)).toEqual({ kind: 'reject', reason: 'oversize' });
  });

  it('never carries input text or the token in a verdict', () => {
    const canary = 'CANARY-TOKEN-abcdefghijklmnopqrstuvwxyz';
    const frames = [
      hello({ token: canary }),
      `${canary} garbage {`,
      JSON.stringify({ type: 'hello', contract: 1, token: canary, pad: 'x'.repeat(MAX_PREAUTH_FRAME_BYTES) }),
    ];
    for (const f of frames) expect(JSON.stringify(checkHello(f, guard))).not.toContain('CANARY');
  });
});

describe('buildHelloAck', () => {
  it('passes parseServerMessage and carries the contract, epoch, auth and limits', () => {
    const ack = buildHelloAck({ epoch: 'ep-1', authRequired: true });
    expect(parseServerMessage(ack).ok).toBe(true);
    expect(ack).toMatchObject({
      type: 'hello_ack',
      contract: CONTRACT_VERSION,
      epoch: 'ep-1',
      auth: { required: true },
      limits: {
        maxFrameBytes: LIMITS.MAX_FRAME_BYTES,
        maxInputBytes: LIMITS.MAX_INPUT_BYTES,
        maxBroadcastTargets: LIMITS.MAX_BROADCAST_TARGETS,
      },
    });
    expect(ack.backends).toHaveLength(1);
    expect(ack.backends[0]).toMatchObject({ id: 'local', up: true });
  });

  it('reports authRequired false', () => {
    expect(buildHelloAck({ epoch: 'e', authRequired: false }).auth).toEqual({ required: false });
  });

  it('carries no token field anywhere', () => {
    expect(JSON.stringify(buildHelloAck({ epoch: 'e', authRequired: true }))).not.toMatch(/token/i);
  });

  it('advertises only capabilities the dispatcher implements', () => {
    const caps = buildHelloAck({ epoch: 'e', authRequired: true }).backends[0].capabilities;
    expect(caps).toEqual(['terminal', 'broadcast']);
    expect(caps).not.toContain('history');
    expect(caps).not.toContain('approve');
  });
});

describe('tracer: hello frame to verdict to ack', () => {
  it('judges the package hello-full fixture and answers with a valid hello_ack', () => {
    const full = fixtures.find((f) => f.name === 'hello-full');
    expect(full).toBeDefined();
    const raw = JSON.stringify({ ...full!.message, token: TOKEN });
    const v = checkHello(raw, guard);
    expect(v.kind).toBe('ok');
    if (v.kind !== 'ok') return;
    expect(v.hello.type).toBe('hello');
    expect(JSON.stringify(v)).toContain(TOKEN); // only inside the parsed message
    expect(Object.keys(v).sort()).toEqual(['hello', 'kind']);
    expect(parseServerMessage(buildHelloAck({ epoch: `ep-${Date.now()}`, authRequired: true })).ok).toBe(true);
  });
});

describe('handshake constants', () => {
  it('pins the close codes, timeout and cap', () => {
    expect(CLOSE_UNAUTHENTICATED).toBe(4401);
    expect(CLOSE_RATE_LIMITED).toBe(4429);
    expect(HELLO_TIMEOUT_MS).toBe(5000);
    expect(MAX_PREAUTH_FRAME_BYTES).toBe(16384);
    expect(UNAUTHENTICATED_REASON).toBe('unauthenticated');
    expect(GATEWAY_CAPABILITIES.length).toBeGreaterThan(0);
  });
});

describe('handshake module logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never writes to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined)
    );
    for (const raw of ['not json', hello(), hello({ token: 'bad' }), 'x'.repeat(20000), '{"type":"ping","t":1}']) {
      checkHello(raw, guard);
    }
    buildHelloAck({ epoch: 'e', authRequired: false });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
