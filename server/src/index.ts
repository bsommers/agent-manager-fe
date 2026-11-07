import express from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG, assertLoopbackBind } from './config.js';
import { SessionManager } from './services/SessionManager.js';
import { WSMessageClient } from './protocol/wsProtocol.js';

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

  wss.on('connection', (ws: WebSocket) => {
    sessionManager.addClient(ws);

    ws.on('message', (data: string) => {
      try {
        const msg = JSON.parse(data.toString()) as WSMessageClient;
        sessionManager.handleClientMessage(msg);
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
