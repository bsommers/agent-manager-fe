import { describe, it, expect, vi } from 'vitest';
import { AgentSocketService } from '../agentSocket';
import { WSMessageServer } from '../wsProtocol';

describe('AgentSocketService', () => {
  it('should allow listeners to subscribe and receive notifications', () => {
    const socketService = new AgentSocketService();
    const mockListener = vi.fn();

    const unsubscribe = socketService.subscribe(mockListener);
    socketService.startMockStream('test-agent-1', 'Test Agent', 'tmux', 'localhost:test');

    expect(mockListener).toHaveBeenCalled();
    const firstCallMsg = mockListener.mock.calls[0][0] as WSMessageServer;
    expect(firstCallMsg.type).toBe('agent:output');
    expect(firstCallMsg.agentId).toBe('test-agent-1');

    unsubscribe();
    socketService.stopMockStream('test-agent-1');
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
});
