import { describe, it, expect } from 'vitest';
import { LIMITS, parseClientMessage, parseServerMessage } from '../../protocol/wsProtocol.js';
import type { WSMessageClient } from '../../protocol/wsProtocol.js';
import { AgentApi } from '../dispatch.js';
import type { DispatchOutcome } from '../dispatch.js';
import { repliesFor, rejectionFor } from '../wsFrames.js';
import type { ParseFailure } from '../wsFrames.js';
import { AgentService } from '../../services/AgentService.js';
import { fail } from '../../services/serviceResult.js';

function failureOf(raw: unknown): ParseFailure {
  const r = parseClientMessage(raw);
  if (r.ok) throw new Error('expected the frame to be rejected');
  return r;
}

const reject = (raw: unknown) => rejectionFor(raw, failureOf(raw));

const failed = (code: 'NOT_FOUND' | 'USAGE' | 'CONFLICT', agentId?: string): DispatchOutcome => {
  const r = fail(code, 'fixed text', { agentId });
  if (r.ok) throw new Error('unreachable');
  return { ok: false, error: r.error };
};

describe('rejectionFor', () => {
  it('names the invalid field and nothing else, as USAGE', () => {
    const frame = reject({ type: 'agent:create', name: '', mode: 'tmux', targetHost: 'h' });
    expect(frame).toMatchObject({ type: 'agent:error', code: 'USAGE', message: 'invalid field: name', retryable: false });
    expect(parseServerMessage(frame).ok).toBe(true);
  });

  it.each([
    ['5000 characters', 'x'.repeat(5000)],
    ['markup', '<img src=x onerror=alert(1)>'.repeat(10)],
    ['control characters', 'bad\u0000\u001b[31mname'],
    ['a nested object', { deep: { deeper: ['secret-value'] } }],
  ])('never puts a value in the message (%s)', (_n, value) => {
    const frame = reject({ type: 'agent:create', name: value, mode: 'tmux', targetHost: 'h' });
    expect(frame).not.toBeNull();
    const text = JSON.stringify(frame);
    expect(text).not.toContain('secret-value');
    expect(text).not.toContain('onerror');
    expect(text).not.toContain('xxxxx');
    expect(text.length).toBeLessThan(400);
  });

  it('falls back to "invalid frame" when the field path is not a conservative identifier', () => {
    const failure: ParseFailure = { ok: false, reason: 'invalid_field', field: 'na me<script>' };
    expect(rejectionFor({ type: 'agent:create' }, failure)?.message).toBe('invalid frame');
    expect(rejectionFor({ type: 'agent:create' }, { ok: false, reason: 'invalid_field' })?.message).toBe(
      'invalid frame'
    );
    expect(
      rejectionFor({ type: 'agent:create' }, { ok: false, reason: 'invalid_field', field: 'f'.repeat(65) })?.message
    ).toBe('invalid frame');
  });

  it('accepts bracketed and dotted field paths up to 64 characters', () => {
    const failure: ParseFailure = { ok: false, reason: 'invalid_field', field: 'targetAgentIds[3]' };
    expect(rejectionFor({ type: 'agent:broadcast' }, failure)?.message).toBe('invalid field: targetAgentIds[3]');
  });

  it.each([
    ['longer than 128 characters', 'x'.repeat(129)],
    ['not a string', 42],
    ['an object', { a: 1 }],
    ['an array', ['a']],
    ['empty', ''],
  ])('does not echo a reqId or agentId that is %s', (_n, bad) => {
    const frame = reject({ type: 'agent:resize', agentId: bad, cols: 0, rows: 24, reqId: bad });
    expect(frame).not.toBeNull();
    expect('agentId' in frame!).toBe(false);
    expect('reqId' in frame!).toBe(false);
  });

  it('echoes valid ids', () => {
    const frame = reject({ type: 'agent:resize', agentId: 'a'.repeat(128), cols: 0, rows: 24, reqId: 'r-1' });
    expect(frame).toMatchObject({ agentId: 'a'.repeat(128), reqId: 'r-1' });
  });

  it('survives __proto__, constructor and prototype keys without pollution or exceptions', () => {
    const raw = JSON.parse(
      '{"type":"agent:create","name":"","mode":"tmux","targetHost":"h","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":1}'
    );
    expect(() => reject(raw)).not.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('does not read ids from the prototype chain', () => {
    const raw = Object.create({ reqId: 'inherited', agentId: 'inherited' });
    Object.assign(raw, { type: 'agent:resize', cols: 0, rows: 24 });
    const frame = rejectionFor(raw, { ok: false, reason: 'invalid_field', field: 'cols' });
    expect('reqId' in frame!).toBe(false);
    expect('agentId' in frame!).toBe(false);
  });

  it('does not throw on deeply nested JSON input', () => {
    let nested: unknown = 'leaf';
    for (let i = 0; i < 5000; i++) nested = { n: nested };
    expect(() => reject({ type: 'agent:create', name: nested, mode: 'tmux', targetHost: 'h' })).not.toThrow();
    expect(() => parseClientMessage({ type: 'agent:update', agentId: 'a', tags: nested })).not.toThrow();
  });

  it('returns null for an unknown type, a non-object and a missing type', () => {
    expect(rejectionFor({ type: 'agent:nope' }, { ok: false, reason: 'unknown_type' })).toBeNull();
    expect(rejectionFor([1], { ok: false, reason: 'not_object' })).toBeNull();
    expect(rejectionFor({}, { ok: false, reason: 'missing_type' })).toBeNull();
  });

  describe('oversized input', () => {
    const over = 'x'.repeat(LIMITS.MAX_INPUT_BYTES + 1);

    it('maps an oversized agent:input to PAYLOAD_TOO_LARGE naming the field and never the value', () => {
      const frame = reject({ type: 'agent:input', agentId: 'a1', data: over, reqId: 'r1' });
      expect(frame).toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'invalid field: data',
        retryable: false,
        agentId: 'a1',
        reqId: 'r1',
      });
      expect(JSON.stringify(frame)).not.toContain('xxxx');
      expect(parseServerMessage(frame).ok).toBe(true);
    });

    it('maps an oversized agent:broadcast the same way', () => {
      const frame = reject({ type: 'agent:broadcast', targetAgentIds: ['a1'], data: over });
      expect(frame).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', message: 'invalid field: data' });
    });

    it('counts UTF-8 bytes, not characters', () => {
      const multi = '€'.repeat(Math.floor(LIMITS.MAX_INPUT_BYTES / 3) + 1); // 3 bytes each, fewer characters than the limit
      expect(multi.length).toBeLessThan(LIMITS.MAX_INPUT_BYTES);
      const frame = reject({ type: 'agent:input', agentId: 'a1', data: multi });
      expect(frame?.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('accepts input of exactly the limit', () => {
      expect(parseClientMessage({ type: 'agent:input', agentId: 'a1', data: 'x'.repeat(LIMITS.MAX_INPUT_BYTES) }).ok).toBe(
        true
      );
    });

    it('keeps an oversized name as USAGE', () => {
      const frame = reject({ type: 'agent:create', name: 'n'.repeat(5000), mode: 'tmux', targetHost: 'h' });
      expect(frame?.code).toBe('USAGE');
    });

    it('keeps another invalid field of an input frame as USAGE even when data is large', () => {
      const frame = reject({ type: 'agent:input', agentId: '', data: over });
      expect(frame?.code).toBe('USAGE');
      expect(frame?.message).toBe('invalid field: agentId');
    });
  });
});

describe('repliesFor', () => {
  const create = { type: 'agent:create', name: 'a', mode: 'tmux', targetHost: 'h', reqId: 'r1' } as WSMessageClient;

  it('acks only when the request carried a reqId', () => {
    const outcome: DispatchOutcome = { ok: true, ack: { op: 'kill' } };
    expect(repliesFor({ type: 'agent:kill', agentId: 'a1', reqId: 'r1' }, outcome)).toEqual([
      { type: 'agent:ack', reqId: 'r1', op: 'kill', ok: true },
    ]);
    expect(repliesFor({ type: 'agent:kill', agentId: 'a1' }, outcome)).toEqual([]);
  });

  it('includes the agent in the ack when the outcome has one', () => {
    const agent = { id: 'a1', name: 'a', mode: 'tmux', targetHost: 'h', status: 'running' } as never;
    const [frame] = repliesFor(create, { ok: true, ack: { op: 'create', agent } });
    expect(frame).toMatchObject({ type: 'agent:ack', op: 'create', agent: { id: 'a1' } });
  });

  it('sends nothing for an ok outcome without an ack descriptor', () => {
    expect(repliesFor(create, { ok: true })).toEqual([]);
    expect(repliesFor({ type: 'agent:broadcast', targetAgentIds: ['a'], data: 'x', reqId: 'r' }, { ok: true, results: [] })).toEqual(
      []
    );
  });

  it('maps a failure to one error frame echoing the reqId and agentId', () => {
    const frames = repliesFor({ type: 'agent:kill', agentId: 'a1', reqId: 'r9' }, failed('NOT_FOUND', 'a1'));
    expect(frames).toEqual([
      { type: 'agent:error', code: 'NOT_FOUND', message: 'fixed text', retryable: false, agentId: 'a1', reqId: 'r9' },
    ]);
  });

  it('never replies with a failure to agent:input or agent:resize', () => {
    expect(repliesFor({ type: 'agent:input', agentId: 'a1', data: 'x' }, failed('NOT_FOUND', 'a1'))).toEqual([]);
    expect(repliesFor({ type: 'agent:resize', agentId: 'a1', cols: 1, rows: 1 }, failed('NOT_FOUND', 'a1'))).toEqual([]);
  });
});

describe('AgentApi.reject and stats.invalidFrames', () => {
  const api = () => new AgentApi(new AgentService(() => {}));

  it('counts one per rejected known-type frame', () => {
    const a = api();
    const bad = { type: 'agent:create', name: '', mode: 'tmux', targetHost: 'h' };
    expect(a.reject(bad, failureOf(bad))).not.toBeNull();
    expect(a.reject(bad, failureOf(bad))).not.toBeNull();
    expect(a.stats.invalidFrames).toBe(2);
  });

  it('does not count unknown types or accepted frames', async () => {
    const a = api();
    const unknown = { type: 'agent:nope' };
    expect(a.reject(unknown, failureOf(unknown))).toBeNull();
    const ok = parseClientMessage({ type: 'ping', t: 1 });
    if (!ok.ok) throw new Error('unreachable');
    await a.execute(ok.msg);
    expect(a.stats.invalidFrames).toBe(0);
  });

  it('counts oversized input as a rejected frame', () => {
    const a = api();
    const bad = { type: 'agent:input', agentId: 'a1', data: 'x'.repeat(LIMITS.MAX_INPUT_BYTES + 1) };
    expect(a.reject(bad, failureOf(bad))?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(a.stats.invalidFrames).toBe(1);
  });
});

describe('validated copy', () => {
  it('strips unknown fields so extras never reach the service', () => {
    const r = parseClientMessage({
      type: 'agent:create',
      name: 'a',
      mode: 'tmux',
      targetHost: 'h',
      evil: 'x',
      __proto__: { y: 1 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.msg).sort()).toEqual(['mode', 'name', 'targetHost', 'type']);
  });
});
