import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from './config.js';
import { SessionManager } from './services/SessionManager.js';
import { WSMessageClient } from './protocol/wsProtocol.js';

async function bootstrap() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: CONFIG.WS_PATH });

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

  server.listen(CONFIG.PORT, () => {
    console.log(`⚡ AI Agent Manager Server listening on http://localhost:${CONFIG.PORT}`);
    console.log(`🔌 WebSocket Endpoint: ws://localhost:${CONFIG.PORT}${CONFIG.WS_PATH}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
