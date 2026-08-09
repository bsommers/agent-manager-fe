import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AddAgentModal } from '../agent/AddAgentModal';
import { agentStore } from '../../store/agentStore';

describe('AddAgentModal Component', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(<AddAgentModal isOpen={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders modal form when isOpen is true and submits new agent', () => {
    const handleClose = vi.fn();
    render(<AddAgentModal isOpen={true} onClose={handleClose} />);

    expect(screen.getByText(/Register New AI Agent/i)).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText(/e.g. Code Review Worker/i);
    const targetInput = screen.getByPlaceholderText(/localhost:tmux_session_2/i);

    act(() => {
      fireEvent.change(nameInput, { target: { value: 'QA Test Agent' } });
      fireEvent.change(targetInput, { target: { value: 'localhost:tmux_qa_test' } });
    });

    const submitBtn = screen.getByRole('button', { name: /Start Agent/i });
    act(() => {
      fireEvent.click(submitBtn);
    });

    expect(handleClose).toHaveBeenCalled();
    const created = agentStore.agents.find((a) => a.name === 'QA Test Agent');
    expect(created).toBeDefined();
    expect(created?.targetHost).toBe('localhost:tmux_qa_test');

    // Clean up
    if (created) {
      act(() => {
        agentStore.removeAgent(created.id);
      });
    }
  });

  it('switches between tmux and ssh mode selection buttons', () => {
    render(<AddAgentModal isOpen={true} onClose={() => {}} />);

    const sshModeBtn = screen.getByRole('button', { name: /Remote SSH/i });
    act(() => {
      fireEvent.click(sshModeBtn);
    });

    expect(screen.getByPlaceholderText(/root@10.0.0.45:22/i)).toBeInTheDocument();
  });
});
