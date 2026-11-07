import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('AddAgentModal accessibility', () => {
  afterEach(() => {
    cleanup();
  });

  const OpenerHarness: React.FC = () => {
    const [open, setOpen] = React.useState(false);
    return (
      <div>
        <button onClick={() => setOpen(true)}>open-add-agent</button>
        <AddAgentModal isOpen={open} onClose={() => setOpen(false)} />
      </div>
    );
  };

  it('is a labelled modal dialog', () => {
    render(<AddAgentModal isOpen={true} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Register New AI Agent' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('associates labels with the name and dynamic target inputs', () => {
    render(<AddAgentModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByLabelText('Agent Name')).toBe(screen.getByPlaceholderText(/e.g. Code Review Worker/i));
    expect(screen.getByLabelText('Tmux Session Name')).toBe(screen.getByPlaceholderText(/localhost:tmux_session_2/i));

    fireEvent.click(screen.getByRole('button', { name: /Remote SSH/i }));
    expect(screen.getByLabelText('SSH Target (user@host:port)')).toBe(screen.getByPlaceholderText(/root@10.0.0.45:22/i));
  });

  it('gives the close button an accessible name and mode buttons aria-pressed', () => {
    render(<AddAgentModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    const tmuxBtn = screen.getByRole('button', { name: /Local Tmux/i });
    const sshBtn = screen.getByRole('button', { name: /Remote SSH/i });
    expect(tmuxBtn).toHaveAttribute('aria-pressed', 'true');
    expect(sshBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(sshBtn);
    expect(tmuxBtn).toHaveAttribute('aria-pressed', 'false');
    expect(sshBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('focuses the Agent Name input on open and closes on Escape', () => {
    const onClose = vi.fn();
    render(<AddAgentModal isOpen={true} onClose={onClose} />);
    expect(screen.getByLabelText('Agent Name')).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<AddAgentModal isOpen={true} onClose={() => {}} />);
    const startBtn = screen.getByRole('button', { name: /Start Agent/i });
    startBtn.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(startBtn).toHaveFocus();
  });

  it('returns focus to the opener after closing', async () => {
    const user = userEvent.setup();
    render(<OpenerHarness />);
    const opener = screen.getByText('open-add-agent');
    opener.focus();
    await user.click(opener);
    expect(screen.getByLabelText('Agent Name')).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('does not submit when a field is blank', () => {
    const onClose = vi.fn();
    const before = agentStore.agents.length;
    render(<AddAgentModal isOpen={true} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Agent Name'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Tmux Session Name'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByRole('button', { name: /Start Agent/i }).closest('form')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(agentStore.agents.length).toBe(before);
  });
});
