import { parseServerMessage, type Agent, type AckOp, type ErrorCode, type WSMessageClient } from './wsProtocol';

/** A request that gets no answer within this time rejects with TIMEOUT. */
export const REQUEST_TIMEOUT_MS = 10000;
/** A request is transmitted at most this many times (the first send plus re-sends after a reconnect). */
const MAX_TRANSMISSIONS = 3;
/** Late answers for this many recently settled requests are swallowed instead of becoming stray notices. */
const SETTLED_MEMORY = 64;

export type RequestErrorCode = ErrorCode | 'NOT_CONNECTED';

export class AgentRequestError extends Error {
  readonly code: RequestErrorCode;
  readonly retryable: boolean;
  readonly reqId: string;
  readonly agentId?: string;

  constructor(code: RequestErrorCode, message: string, opts: { retryable?: boolean; reqId?: string; agentId?: string } = {}) {
    super(message);
    this.name = 'AgentRequestError';
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.reqId = opts.reqId ?? '';
    if (opts.agentId !== undefined) this.agentId = opts.agentId;
  }
}

export interface AckResult {
  op: AckOp;
  agent?: Agent;
}

export interface RequestHandle {
  reqId: string;
  promise: Promise<AckResult>;
}

/** A reqId is a correlation key, not a secret; prefer crypto, never throw. */
export function newReqId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface AgentRequestsDeps {
  /** Returns true only when the frame was written to an open connection. */
  send: (msg: WSMessageClient) => boolean;
  timeoutMs?: number;
  maxTransmissions?: number;
  newReqId?: () => string;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface InFlight {
  frame: WSMessageClient;
  transmissions: number;
  timer: unknown;
  resolve: (r: AckResult) => void;
  reject: (e: AgentRequestError) => void;
}

/**
 * Correlates client requests with the gateway's agent:ack / agent:error by reqId.
 * Holds only in-flight entries plus the ids of the last SETTLED_MEMORY settled requests.
 */
export class AgentRequests {
  private readonly send: AgentRequestsDeps['send'];
  private readonly timeoutMs: number;
  private readonly maxTransmissions: number;
  private readonly makeId: () => string;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly inFlight = new Map<string, InFlight>();
  private readonly settledIds = new Set<string>();

  constructor(deps: AgentRequestsDeps) {
    this.send = deps.send;
    this.timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.maxTransmissions = deps.maxTransmissions ?? MAX_TRANSMISSIONS;
    this.makeId = deps.newReqId ?? newReqId;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /**
   * Builds the frame with a fresh reqId and sends it once. Throws AgentRequestError('NOT_CONNECTED')
   * synchronously, keeping nothing, when the connection is not open.
   */
  request(build: (reqId: string) => WSMessageClient): RequestHandle {
    const reqId = this.makeId();
    const frame = build(reqId);
    if (!this.send(frame)) {
      throw new AgentRequestError('NOT_CONNECTED', 'The backend is not connected.', { reqId, retryable: true });
    }
    let resolve!: (r: AckResult) => void;
    let reject!: (e: AgentRequestError) => void;
    const promise = new Promise<AckResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const entry: InFlight = { frame, transmissions: 1, timer: undefined, resolve, reject };
    this.inFlight.set(reqId, entry);
    this.armTimer(reqId, entry);
    return { reqId, promise };
  }

  /** 'consumed' when the message answers an in-flight or recently settled request, else 'ignored'. */
  handleServerMessage(msg: unknown): 'consumed' | 'ignored' {
    if (typeof msg !== 'object' || msg === null) return 'ignored';
    const m = msg as { type?: unknown; reqId?: unknown };
    if (m.type !== 'agent:ack' && m.type !== 'agent:error') return 'ignored';
    if (typeof m.reqId !== 'string') return 'ignored';
    const entry = this.inFlight.get(m.reqId);
    if (!entry) return this.settledIds.has(m.reqId) ? 'consumed' : 'ignored';

    const parsed = parseServerMessage(msg);
    if (!parsed.ok || parsed.msg.type !== m.type) {
      this.settle(m.reqId, () =>
        entry.reject(new AgentRequestError('INTERNAL', 'The backend sent an invalid answer.', { reqId: m.reqId as string })),
      );
      return 'consumed';
    }
    const valid = parsed.msg;
    if (valid.type === 'agent:ack') {
      const result: AckResult = { op: valid.op, ...(valid.agent ? { agent: valid.agent } : {}) };
      this.settle(m.reqId, () => entry.resolve(result));
    } else if (valid.type === 'agent:error') {
      this.settle(m.reqId, () =>
        entry.reject(
          new AgentRequestError(valid.code, valid.message, {
            retryable: valid.retryable,
            reqId: m.reqId as string,
            agentId: valid.agentId,
          }),
        ),
      );
    }
    return 'consumed';
  }

  /** Re-sends every in-flight frame unchanged (same reqId) after the connection reopened. */
  resendInFlight(): void {
    for (const [reqId, entry] of this.inFlight) {
      if (entry.transmissions >= this.maxTransmissions) continue;
      if (!this.send(entry.frame)) continue;
      entry.transmissions += 1;
      this.armTimer(reqId, entry);
    }
  }

  /** Drops all entries and timers without rejecting (tests). */
  clear(): void {
    for (const entry of this.inFlight.values()) this.clearTimer(entry.timer);
    this.inFlight.clear();
    this.settledIds.clear();
  }

  /** Rejects everything in flight with NOT_CONNECTED. */
  dispose(): void {
    for (const [reqId, entry] of [...this.inFlight]) {
      this.settle(reqId, () =>
        entry.reject(new AgentRequestError('NOT_CONNECTED', 'The backend is not connected.', { reqId, retryable: true })),
      );
    }
  }

  private armTimer(reqId: string, entry: InFlight): void {
    this.clearTimer(entry.timer);
    entry.timer = this.setTimer(() => {
      this.settle(reqId, () =>
        entry.reject(
          new AgentRequestError('TIMEOUT', 'The backend did not answer in time.', { reqId, retryable: true }),
        ),
      );
    }, this.timeoutMs);
  }

  private settle(reqId: string, finish: () => void): void {
    const entry = this.inFlight.get(reqId);
    if (!entry) return;
    this.clearTimer(entry.timer);
    this.inFlight.delete(reqId);
    this.settledIds.add(reqId);
    if (this.settledIds.size > SETTLED_MEMORY) {
      const oldest = this.settledIds.values().next().value as string;
      this.settledIds.delete(oldest);
    }
    finish();
  }
}
