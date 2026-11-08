import express from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG, assertLoopbackBind } from './config.js';
import { SessionManager } from './services/SessionManager.js';
import { parseClientMessage } from './protocol/wsProtocol.js';

export interface BootstrapOptions {
  allowedOrigins?: string[];
  heartbeatMs?: number;
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
  assertLoopbackBind(host);
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? CONFIG.ALLOWED_ORIGINS).map((o) => o.replace(/\/+$/, ''))
  );
  const app = express();
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
    sessionManager.addClient(ws);

    ws.on('message', (data: string) => {
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
        sessionManager.handleClientMessage(result.msg, (reply) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
        });
      } catch (err) {
        console.error('Invalid WebSocket message received:', err);
      }
    });

    ws.on('close', () => {
      sessionManager.removeClient(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket client error:', err);
      sessionManager.removeClient(ws);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      if (process.env.NODE_ENV !== 'test') {
        console.log(`⚡ AI Agent Manager Server listening on http://${host}:${port}`);
        console.log(`🔌 WebSocket Endpoint: ws://${host}:${port}${CONFIG.WS_PATH}`);
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
