import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import { CONTRACT_VERSION, parseClientMessage } from '../protocol/wsProtocol.js';
import type { AgentApi } from '../gateway/dispatch.js';
import { rejectionFor } from '../gateway/wsFrames.js';
import type { AgentService } from '../services/AgentService.js';
import { errorEnvelope, outcomeToHttp, statusFor } from './envelope.js';
import type { HttpReply } from './envelope.js';

export interface ApiRouterDeps {
  api: AgentApi;
  /** Read-only use: list and count. Every mutation goes through `api.execute`. */
  service: Pick<AgentService, 'list' | 'count'>;
  allowedOrigins: ReadonlySet<string>;
  /** Per-process identity reported by /api/health. */
  epoch: string;
}

/** JSON bodies larger than this are PAYLOAD_TOO_LARGE. */
export const MAX_BODY_BYTES = 64 * 1024;

function send(res: Response, reply: HttpReply): void {
  res.status(reply.status).json(reply.body);
}

function isPlainBody(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The HTTP wrapper over the service layer. Handlers parse their input into the same validated client
 * message the WebSocket uses, run it through `AgentApi.execute` and map the outcome to the contract's
 * bodies. No handler touches the registry, a driver or tmux.
 */
export function createApiRouter(deps: ApiRouterDeps): Router {
  const { api, service, epoch } = deps;
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
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
    express.json({ limit: MAX_BODY_BYTES }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = isPlainBody(req.body) ? req.body : null;
        if (!body) {
          send(res, { status: 400, body: errorEnvelope('USAGE', 'request body must be a JSON object') });
          return;
        }
        const { reqId: _ignored, ...fields } = body;
        const candidate = { ...fields, type: 'agent:create' };
        const parsed = parseClientMessage(candidate);
        if (!parsed.ok) {
          const frame = rejectionFor(candidate, parsed);
          const code = frame?.code ?? 'USAGE';
          send(res, {
            status: statusFor(code),
            body: errorEnvelope(code, frame?.message ?? 'invalid request', frame?.retryable ?? false),
          });
          return;
        }
        const outcome = await api.execute(parsed.msg);
        send(
          res,
          outcomeToHttp(outcome, (o) =>
            o.ack?.agent ? { status: 201, body: { ok: true, agent: o.ack.agent } } : null
          )
        );
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
