import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { CONTRACT_VERSION, listHttpRoutes, parseClientMessage } from '../protocol/wsProtocol.js';
import type { WSMessageClient } from '../protocol/wsProtocol.js';
import type { AgentApi } from '../gateway/dispatch.js';
import { rejectionFor } from '../gateway/wsFrames.js';
import type { AgentService } from '../services/AgentService.js';
import { errorEnvelope, outcomeToHttp, sanitizeField, statusFor } from './envelope.js';
import type { HttpReply } from './envelope.js';

export interface ApiRouterDeps {
  api: AgentApi;
  /** Read-only use: list and count. Every mutation goes through `api.execute`. */
  service: Pick<AgentService, 'list' | 'count'>;
  /** Normalized origins (no trailing slash) allowed to send mutating requests. */
  allowedOrigins: ReadonlySet<string>;
  /** Per-process identity reported by /api/health. */
  epoch: string;
}

/** JSON bodies larger than this are PAYLOAD_TOO_LARGE. */
export const MAX_BODY_BYTES = 64 * 1024;

/** An Idempotency-Key is the reqId: 1 to 128 printable ASCII characters, no spaces. */
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,128}$/;

/** The routes this router implements; every other catalog route answers UNSUPPORTED. */
const IMPLEMENTED_CATALOG_ROUTES: readonly string[] = ['DELETE /api/agents/:id', 'GET /api/agents', 'POST /api/agents'];

/** The exempt liveness probe (not in the catalog). */
const HEALTH_ROUTE = 'GET /api/health';

/** Identities this router answers: implemented, UNSUPPORTED (derived from the catalog) and the health probe. */
export function registeredRouteIds(): string[] {
  const unsupported = listHttpRoutes()
    .map((r) => r.id)
    .filter((id) => !IMPLEMENTED_CATALOG_ROUTES.includes(id));
  return [...IMPLEMENTED_CATALOG_ROUTES, ...unsupported, HEALTH_ROUTE].sort();
}

function send(res: Response, reply: HttpReply): void {
  res.status(reply.status).json(reply.body);
}

function sendError(res: Response, code: Parameters<typeof statusFor>[0], message: string, retryable?: boolean): void {
  send(res, { status: statusFor(code), body: errorEnvelope(code, message, retryable) });
}

function isPlainBody(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates a candidate frame with the package validator; a failure becomes the same typed error the WS sends. */
function validated(candidate: Record<string, unknown>, res: Response): WSMessageClient | null {
  const parsed = parseClientMessage(candidate);
  if (parsed.ok) return parsed.msg;
  const frame = rejectionFor(candidate, parsed);
  if (frame) sendError(res, frame.code, frame.message, frame.retryable);
  else sendError(res, 'USAGE', sanitizeField(parsed.field), false);
  return null;
}

/** Wraps an async handler so a rejection reaches the error middleware instead of hanging the request. */
function guarded(handler: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  };
}

function oneLine(err: unknown): string {
  const text = err instanceof Error ? err.message : 'non-error thrown';
  return text.replace(/[^\x20-\x7e]/g, ' ').slice(0, 200);
}

/**
 * The HTTP wrapper over the service layer. Handlers parse their input into the same validated client
 * message the WebSocket uses, run it through `AgentApi.execute` and map the outcome to the contract's
 * bodies. No handler touches the registry, a driver or tmux. No CORS headers are ever sent: the FE
 * talks to the gateway over WebSocket, and a cross-origin page cannot read or preflight these routes.
 */
export function createApiRouter(deps: ApiRouterDeps): Router {
  const { api, service, allowedOrigins, epoch } = deps;
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // CSRF guard, before anything else is read: a mutating request from a foreign Origin is refused.
  // Browsers always send Origin on cross-site POST and DELETE; non-browser local tools send none.
  router.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin.replace(/\/+$/, ''))) {
      sendError(res, 'FORBIDDEN', 'origin not allowed');
      return;
    }
    next();
  });

  router.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      contract: CONTRACT_VERSION,
      epoch,
      backends: [{ id: 'local', up: true }],
      agents: service.count(),
    });
  });

  router.get('/agents', (_req, res) => {
    res.status(200).json({ ok: true, agents: service.list() });
  });

  router.post(
    '/agents',
    (req, res, next) => {
      if (!req.is('application/json')) {
        sendError(res, 'USAGE', 'content type must be application/json', false);
        return;
      }
      next();
    },
    express.json({ limit: MAX_BODY_BYTES }),
    guarded(async (req, res) => {
      if (!isPlainBody(req.body)) {
        sendError(res, 'USAGE', 'request body must be a JSON object', false);
        return;
      }
      // The header is the contract: a body reqId is dropped before validation.
      const { reqId: _bodyReqId, ...fields } = req.body;
      const candidate: Record<string, unknown> = { ...fields, type: 'agent:create' };

      const key = req.headers['idempotency-key'];
      if (key !== undefined) {
        if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key)) {
          sendError(res, 'USAGE', 'invalid header: Idempotency-Key', false);
          return;
        }
        candidate.reqId = key;
      }

      const msg = validated(candidate, res);
      if (!msg) return;
      const outcome = await api.execute(msg);
      send(
        res,
        outcomeToHttp(outcome, (o) =>
          o.ack?.agent ? { status: 201, body: { ok: true, agent: o.ack.agent } } : null
        )
      );
    })
  );

  router.delete(
    '/agents/:id',
    guarded(async (req, res) => {
      const msg = validated({ type: 'agent:kill', agentId: req.params.id }, res);
      if (!msg) return;
      const outcome = await api.execute(msg);
      send(res, outcomeToHttp(outcome, () => ({ status: 200, body: { ok: true } })));
    })
  );

  // Catalogued routes that a later phase implements: distinguishable from a path that does not exist.
  for (const route of listHttpRoutes()) {
    if (IMPLEMENTED_CATALOG_ROUTES.includes(route.id)) continue;
    const path = route.binding.path.replace(/^\/api/, '');
    const method = route.binding.method.toLowerCase() as 'get' | 'post' | 'delete';
    router[method](path, (_req: Request, res: Response) => {
      sendError(res, 'UNSUPPORTED', 'this operation is not supported by this gateway', false);
    });
  }

  router.use((_req, res) => {
    sendError(res, 'NOT_FOUND', 'no such route', false);
  });

  // Final error handler: fixed messages only, never the request or a stack.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    // body-parser and Express path decoding report client faults as errors with a 4xx status.
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 413) {
      sendError(res, 'PAYLOAD_TOO_LARGE', 'request body too large', false);
      return;
    }
    if (typeof status === 'number' && status >= 400 && status < 500) {
      sendError(res, 'USAGE', 'invalid request', false);
      return;
    }
    console.error(`[api] internal error: ${oneLine(err)}`);
    sendError(res, 'INTERNAL', 'internal error');
  });

  return router;
}
