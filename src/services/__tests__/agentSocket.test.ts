import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentSocketService } from '../agentSocket';
import { WSMessageServer } from '../wsProtocol';

describe('AgentSocketService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow listeners to subscribe and receive notifications', () => {
    const socketService = new AgentSocketService();
    const mockListener = vi.fn();

    const unsubscribe = socketService.subscribe(mockListener);
    socketService.startMockStream('test-agent-1', 'Test Agent', 'tmux', 'localhost:test');

    expect(mockListener).toHaveBeenCalled();
    const firstCallMsg = mockListener.mock.calls[0][0] as WSMessageServer;
    expect(firstCallMsg.type).toBe('agent:output');
    if (firstCallMsg.type === 'agent:output') {
      expect(firstCallMsg.agentId).toBe('test-agent-1');
    }

    unsubscribe();
    socketService.stopMockStream('test-agent-1');
  });

  it('should trigger periodic mock heartbeat logs until stopped', () => {
    const socketService = new AgentSocketService();
    const receivedMsgs: WSMessageServer[] = [];

    const unsubscribe = socketService.subscribe((msg) => receivedMsgs.push(msg));
    socketService.startMockStream('test-agent-hb', 'HB Agent', 'tmux', 'localhost:hb');

    expect(receivedMsgs.length).toBe(1); // Banner

    vi.advanceTimersByTime(15000);
    expect(receivedMsgs.length).toBeGreaterThanOrEqual(2);

    socketService.stopMockStream('test-agent-hb');
    const msgCountBefore = receivedMsgs.length;

    vi.advanceTimersByTime(30000);
    expect(receivedMsgs.length).toBe(msgCountBefore); // No new logs after stop

    unsubscribe();
  });

  it('should handle agent:input messages in mock mode', () => {
    const socketService = new AgentSocketService();
    const receivedMsgs: WSMessageServer[] = [];

    const unsubscribe = socketService.subscribe((msg) => receivedMsgs.push(msg));
    socketService.send({
      type: 'agent:input',
      agentId: 'test-agent-2',
      data: 'help',
    });

    expect(receivedMsgs.length).toBe(1);
    expect(receivedMsgs[0].type).toBe('agent:output');
    if (receivedMsgs[0].type === 'agent:output') {
      expect(receivedMsgs[0].data).toContain('Available mock commands');
    }

    unsubscribe();
  });

  it('should send JSON over live WebSocket when socket is open', () => {
    const socketService = new AgentSocketService();
    const mockWs: any = {
      readyState: 1, // WebSocket.OPEN
      send: vi.fn(),
    };

    (socketService as any).isMockMode = false;
    (socketService as any).ws = mockWs;

    socketService.send({
      type: 'agent:resize',
      agentId: 'agent-live',
      cols: 120,
      rows: 40,
    });

    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'agent:resize',
        agentId: 'agent-live',
        cols: 120,
        rows: 40,
      })
    );
  });
});
