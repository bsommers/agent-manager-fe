import { describe, it, expect } from 'vitest';
import { WSMessageClient, WSMessageServer } from '../wsProtocol.js';

describe('wsProtocol', () => {
  it('should format client and server WebSocket messages correctly', () => {
    const inputMsg: WSMessageClient = {
      type: 'agent:input',
      agentId: 'agent-1',
      data: 'ls -la\r',
    };

    const outputMsg: WSMessageServer = {
      type: 'agent:output',
      agentId: 'agent-1',
      data: 'total 0\r\n',
    };

    expect(JSON.parse(JSON.stringify(inputMsg))).toEqual(inputMsg);
    expect(JSON.parse(JSON.stringify(outputMsg))).toEqual(outputMsg);
  });
});
