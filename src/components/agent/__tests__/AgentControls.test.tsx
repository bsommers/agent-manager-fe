import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { AgentControls } from '../AgentControls';
import { agentSocket } from '../../../services/agentSocket';
import { useAgentStore } from '../../../store/agentStore';

describe('AgentControls Component', () => {
  const agentId = 'ctrl-test-agent';

  beforeEach(() => {
    useAgentStore.setState({
      agents: [
        {
          id: agentId,
          name: 'Ctrl Agent',
          mode: 'tmux',
          targetHost: 'localhost:ctrl',
          status: 'running',
          unreadOutput: false,
          layout: { isFloating: false },
          createdAt: Date.now(),
          lastActivity: Date.now(),
        },
      ],
      activeAgentId: agentId,
    });
  });

  it('should send SIGINT (\\x03) on Ctrl+C button click', () => {
    const sendSpy = vi.spyOn(agentSocket, 'send').mockImplementation(() => {});
    const { getByTitle } = render(<AgentControls agentId={agentId} isFloating={false} />);

    const ctrlCButton = getByTitle('Send SIGINT (Ctrl+C)');
    fireEvent.click(ctrlCButton);

    expect(sendSpy).toHaveBeenCalledWith({
      type: 'agent:input',
      agentId,
      data: '\x03',
    });

    sendSpy.mockRestore();
  });

  it('should send clear command on Clear button click', () => {
    const sendSpy = vi.spyOn(agentSocket, 'send').mockImplementation(() => {});
    const { getByText } = render(<AgentControls agentId={agentId} isFloating={false} />);

    const clearButton = getByText('Clear');
    fireEvent.click(clearButton);

    expect(sendSpy).toHaveBeenCalledWith({
      type: 'agent:input',
      agentId,
      data: 'clear\r',
    });

    sendSpy.mockRestore();
  });

  it('should toggle undock floating layout on undock button click', () => {
    const { getByTitle } = render(<AgentControls agentId={agentId} isFloating={false} />);

    const undockButton = getByTitle('Pop out Floating Window');
    fireEvent.click(undockButton);

    const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
    expect(agent?.layout.isFloating).toBe(true);
  });

  it('should remove agent from store on Close button click', () => {
    const { getByTitle } = render(<AgentControls agentId={agentId} isFloating={false} />);

    const closeButton = getByTitle('Close Agent');
    fireEvent.click(closeButton);

    const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
    expect(agent).toBeUndefined();
  });
});
