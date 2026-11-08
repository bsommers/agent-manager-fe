import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootstrap } from '../src/index.js';
import { WebSocket } from 'ws';
import http from 'http';

vi.mock('../src/services/TmuxDiscovery.js', () => ({
  discoverTmuxSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/TmuxDriver.js', () => ({
  TmuxDriver: vi.fn().mockImplementation(() => ({
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
  })),
}));

describe('Server & WebSocket Integration (server/src/index.ts)', () => {
  let serverHandle: any;
  let testPort: number;

  beforeEach(async () => {
    testPort = Math.floor(Math.random() * 1000) + 18000;
    serverHandle = await bootstrap(testPort, '127.0.0.1');
  });

  afterEach(async () => {
    if (serverHandle) {
      serverHandle.wss.close();
      await new Promise<void>((resolve) => serverHandle.server.close(() => resolve()));
    }
  });

  it('should respond with health metrics on GET /health', async () => {
    const data = await new Promise<any>((resolve, reject) => {
      http.get(`http://127.0.0.1:${testPort}/health`, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(JSON.parse(body)));
        res.on('error', reject);
      });
    });

    expect(data.status).toBe('ok');
    expect(typeof data.agents).toBe('number');
    expect(data.timestamp).toBeDefined();
  });

  it('should handle WebSocket connection and initial agent list', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);

    const msg = await new Promise<any>((resolve) => {
      ws.on('message', (raw) => resolve(JSON.parse(raw.toString())));
    });

    expect(msg.type).toBe('agent:init_list');
    expect(Array.isArray(msg.agents)).toBe(true);

    ws.close();
  });

  it('should handle WebSocket client messages (create, input, resize, kill)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);

    await new Promise<void>((resolve) => ws.on('open', resolve));

    // Create agent
    ws.send(
      JSON.stringify({
        type: 'agent:create',
        name: 'WS Test Agent',
        mode: 'tmux',
        targetHost: 'localhost:ws_test',
      })
    );

    // The create is announced as agent:added (plan 06-04); the connect snapshot is empty.
    const addedMsg = await new Promise<any>((resolve) => {
      ws.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());
        if (parsed.type === 'agent:added') resolve(parsed);
      });
    });

    expect(addedMsg.agent.name).toBe('WS Test Agent');
    const createdAgentId = addedMsg.agent.id;

    // Input message
    ws.send(
      JSON.stringify({
        type: 'agent:input',
        agentId: createdAgentId,
        data: 'echo hello\r',
      })
    );

    // Resize message
    ws.send(
      JSON.stringify({
        type: 'agent:resize',
        agentId: createdAgentId,
        cols: 100,
        rows: 30,
      })
    );

    // Kill message
    ws.send(
      JSON.stringify({
        type: 'agent:kill',
        agentId: createdAgentId,
      })
    );

    ws.close();
  });

  it('should handle invalid JSON WebSocket payload gracefully without crashing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);

    await new Promise<void>((resolve) => ws.on('open', resolve));

    ws.send('invalid-non-json-payload');

    await new Promise((r) => setTimeout(r, 100));

    expect(consoleSpy).toHaveBeenCalledWith('Invalid WebSocket message received:', expect.any(Error));

    consoleSpy.mockRestore();
    ws.close();
  });

  it('should handle socket error and close events cleanly', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);
    ws.on('error', () => {}); // Catch client side error

    await new Promise<void>((resolve) => ws.on('open', resolve));

    // Trigger server-side socket error handler
    const serverSocket = Array.from(serverHandle.wss.clients)[0] as WebSocket;
    if (serverSocket) {
      serverSocket.emit('error', new Error('Server socket error'));
    }

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    consoleSpy.mockRestore();
  });
});
