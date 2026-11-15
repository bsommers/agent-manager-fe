import express from 'express';
import { createServer, Server } from 'http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG, assertBindPolicy, resolveAuthToken, validateAuthToken } from './config.js';
import { SessionManager } from './services/SessionManager.js';
import { parseClientMessage } from './protocol/wsProtocol.js';
import { createApiRouter } from './http/apiRouter.js';
import { createAuthGuard, safeLogError } from './gateway/auth.js';
import { createAuthThrottle } from './gateway/authThrottle.js';
import type { ThrottleOptions } from './gateway/authThrottle.js';
import {
  CLOSE_UNAUTHENTICATED,
  UNAUTHENTICATED_REASON,
  buildHelloAck,
  checkHello,
} from './gateway/handshake.js';

export interface BootstrapOptions {
  allowedOrigins?: string[];
  heartbeatMs?: number;
  /** Identity reported by /api/health; defaults to a random id per process. */
  epoch?: string;
  /**
   * The shared secret. When the key is present (even as undefined) it decides: undefined means no
   * authentication and the environment is ignored. When the key is absent AGENT_MANAGER_TOKEN is read.
   */
  token?: string;
  /** Key the auth throttle by the last X-Forwarded-For entry when the socket peer is loopback. */
  trustProxy?: boolean;
  /** How long a socket may stay silent before it is closed 4401. */
  helloTimeoutMs?: number;
  /** Throttle limits and clock (tests inject tiny limits and a fake clock). */
  throttle?: Partial<ThrottleOptions>;
}

export async function bootstrap(
  port: number = CONFIG.PORT,
  host: string = CONFIG.HOST,
  options: BootstrapOptions = {}
): Promise<{
  app: express.Application;
  server: Server;
  wss: WebSocketServer;
  sessionManager: SessionManager;
}> {
  // Decide authentication first: an explicit `token` key (even undefined) beats the environment (D-12).
  const token = Object.prototype.hasOwnProperty.call(options, 'token')
    ? options.token
    : resolveAuthToken(process.env);
  if (token !== undefined) validateAuthToken(token);
  assertBindPolicy(host, token);
  const trustProxy = options.trustProxy ?? CONFIG.TRUST_PROXY;
  const guard = token === undefined ? undefined : createAuthGuard(token);
  const secrets: readonly string[] = token === undefined ? [] : [token];
  const throttle = createAuthThrottle(options.throttle);
  const epoch = options.epoch ?? randomUUID();

  const allowedOrigins = new Set(
    (options.allowedOrigins ?? CONFIG.ALLOWED_ORIGINS).map((o) => o.replace(/\/+$/, ''))
  );
  const app = express();
  app.disable('x-powered-by');
  const server = createServer(app);
  const wss = new WebSocketServer({
    server,
    path: CONFIG.WS_PATH,
    maxPayload: CONFIG.MAX_PAYLOAD_BYTES,
    verifyClient: (info, cb) => {
      const origin = info.origin;
      // Browsers always send Origin; non-browser local tools do not.
      if (!origin || allowedOrigins.has(origin.replace(/\/+$/, ''))) {
        cb(true);
      } else {
        cb(false, 403, 'Origin not allowed');
      }
    },
  });

  const sessionManager = new SessionManager();
  await sessionManager.initialize();

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      agents: sessionManager.getAgentCount(),
      timestamp: new Date().toISOString(),
    });
  });

  app.use(
    '/api',
    createApiRouter({
      api: sessionManager.api,
      service: sessionManager.service,
      allowedOrigins,
      host,
      epoch,
    })
  );

  // Liveness: terminate sockets that stop answering protocol pings.
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
  }, options.heartbeatMs ?? CONFIG.HEARTBEAT_MS);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: WebSocket) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    // With a token the socket is not in the broadcast set (and gets no roster) until a valid hello.
    let authed = guard === undefined;
    let closing = false;
    const ack = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(buildHelloAck({ epoch, authRequired: guard !== undefined })));
      }
    };

    // Listeners first, so any early close below leaves nothing unhandled.
    ws.on('close', () => {
      sessionManager.removeClient(ws);
    });

    ws.on('error', (err) => {
      // A label only: the error object can carry request text.
      const label = (err as NodeJS.ErrnoException).code ?? err.name;
      console.error('WebSocket client error:', label);
      sessionManager.removeClient(ws);
    });

    if (authed) sessionManager.addClient(ws);

    ws.on('message', (data: string) => {
      if (!authed) {
        if (closing) return;
        const verdict = checkHello(data.toString(), guard!);
        if (verdict.kind === 'reject') {
          closing = true;
          ws.close(CLOSE_UNAUTHENTICATED, UNAUTHENTICATED_REASON);
          return;
        }
        authed = true;
        ack();
        sessionManager.addClient(ws);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(data.toString());
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed) ||
          typeof (parsed as { type?: unknown }).type !== 'string'
        ) {
          throw new Error('Client frame must be a JSON object with a string "type"');
        }
        const frame = parsed as { type: string; t?: unknown };
        if (frame.type === 'ping') {
          if (typeof frame.t === 'number' && Number.isFinite(frame.t)) {
            ws.send(JSON.stringify({ type: 'pong', t: frame.t }));
          }
          return;
        }
        const result = parseClientMessage(parsed);
        if (!result.ok) {
          const rejection = sessionManager.api.reject(parsed, result);
          if (rejection && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(rejection));
          return;
        }
        if (result.msg.type === 'hello') {
          // The handshake is the gateway's, not the session manager's; the token is not re-checked.
          ack();
          return;
        }
        sessionManager.handleClientMessage(result.msg, (reply) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
        });
      } catch (err) {
        console.error('Invalid WebSocket message received:', safeLogError(err, secrets));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      if (process.env.NODE_ENV !== 'test') {
        console.log(`⚡ AI Agent Manager Server listening on http://${host}:${port}`);
        console.log(`🔌 WebSocket Endpoint: ws://${host}:${port}${CONFIG.WS_PATH}`);
        console.log(
          guard
            ? 'Authentication: enabled (AGENT_MANAGER_TOKEN)'
            : 'Authentication: disabled (loopback-only, no AGENT_MANAGER_TOKEN)'
        );
        if (guard && !trustProxy) {
          console.log(
            'Behind a reverse proxy set AGENT_MANAGER_TRUST_PROXY=1, or all proxied clients share one auth throttle key.'
          );
        }
      }
      resolve();
    });
  });

  return { app, server, wss, sessionManager };
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    console.error('Fatal error starting server:', err);
    process.exit(1);
  });
}
