import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AgentControls } from '../AgentControls';
import { DestructiveSafetyModal } from '../../layout/DestructiveSafetyModal';
import { agentSocket } from '../../../services/agentSocket';
import { useAgentStore } from '../../../store/agentStore';
import { useConnectionStore } from '../../../store/connectionStore';
import type { WSMessageClient } from '../../../services/wsProtocol';
import type { Agent } from '../../../types/agent';

const AGENT: Agent = {
  id: 'a1',
  name: 'Build Box',
  mode: 'tmux',
  targetHost: 'localhost:qa_a',
  status: 'running',
  unreadOutput: false,
  layout: { isFloating: false },
  createdAt: 1000,
  lastActivity: 2000,
};

const killBtn = () => screen.queryByRole('button', { name: /^Kill tmux session/ });

describe('AgentControls: Kill tmux session', () => {
  let send: MockInstance<[WSMessageClient], boolean>;

  beforeEach(() => {
    useConnectionStore.setState({ mode: 'live' });
    useAgentStore.setState({
      agents: [AGENT],
      activeAgentId: 'a1',
      pending: {},
      killing: {},
      rosterNotices: [],
    });
    send = vi.spyOn(agentSocket, 'send').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useConnectionStore.setState({ mode: 'demo' });
    useAgentStore.setState({ agents: [], pending: {}, killing: {}, rosterNotices: [] });
  });

  const renderControls = (id = 'a1', name = 'Build Box') =>
    render(<AgentControls agentId={id} isFloating={false} agentName={name} />);

  describe('visibility', () => {
    it('is present for a live tmux agent with the expected name and title', () => {
      renderControls();
      const b = killBtn();
      expect(b).not.toBeNull();
      expect(b!.getAttribute('aria-label')).toBe('Kill tmux session of Build Box');
      expect(b!.getAttribute('title')).toBe('Kill tmux session...');
      expect(b!.getAttribute('type')).toBe('button');
    });

    it('uses the bare name when no agent name is given', () => {
      render(<AgentControls agentId="a1" isFloating={false} />);
      expect(killBtn()!.getAttribute('aria-label')).toBe('Kill tmux session');
    });

    it('is absent for an ssh agent', () => {
      useAgentStore.setState({ agents: [{ ...AGENT, mode: 'ssh', targetHost: 'user@host' }] });
      renderControls();
      expect(killBtn()).toBeNull();
    });

    it('is absent in Demo mode', () => {
      useConnectionStore.setState({ mode: 'demo' });
      renderControls();
      expect(killBtn()).toBeNull();
    });

    it('is absent for an agent that is not in the store', () => {
      renderControls('ghost');
      expect(killBtn()).toBeNull();
    });

    it('is absent for a pending pane', () => {
      useAgentStore.setState({
        pending: { a1: { name: 'Build Box', mode: 'tmux', targetHost: 'localhost:qa_a', startedAt: 1 } },
      });
      renderControls();
      expect(killBtn()).toBeNull();
    });

    it('is absent while a kill is already in flight', () => {
      useAgentStore.setState({ killing: { a1: Date.now() } });
      renderControls();
      expect(killBtn()).toBeNull();
    });

    it('does not change the existing Close control', () => {
      renderControls();
      fireEvent.click(screen.getByRole('button', { name: 'Close agent Build Box' }));
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({ type: 'agent:kill', agentId: 'a1', reqId: expect.any(String) });
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  describe('confirmation modal', () => {
    it('opens an alertdialog naming the agent, session and command with focus on Cancel', () => {
      renderControls();
      fireEvent.click(killBtn()!);
      const dlg = screen.getByRole('alertdialog');
      expect(dlg.textContent).toContain('Build Box');
      expect(dlg.textContent).toContain('qa_a');
      expect(dlg.textContent).toContain('tmux kill-session -t qa_a');
      expect(dlg.textContent).toContain('cannot be undone');
      expect(dlg.textContent).toContain('Command the gateway will run');
      expect(dlg.textContent).toContain('Agent that will be removed');
      expect(within(dlg).getByRole('heading', { name: 'Kill tmux session' })).toBeTruthy();
      expect(document.activeElement).toBe(within(dlg).getByRole('button', { name: 'Cancel' }));
      expect(send).not.toHaveBeenCalled();
    });

    it('uses the whole target as the session when there is no host prefix', () => {
      useAgentStore.setState({ agents: [{ ...AGENT, targetHost: 'solo' }] });
      renderControls();
      fireEvent.click(killBtn()!);
      expect(screen.getByRole('alertdialog').textContent).toContain('tmux kill-session -t solo');
    });

    it('uses the part after the first colon only', () => {
      useAgentStore.setState({ agents: [{ ...AGENT, targetHost: 'h:s:x' }] });
      renderControls();
      fireEvent.click(killBtn()!);
      expect(screen.getByRole('alertdialog').textContent).toContain('tmux kill-session -t s:x');
    });

    it('Cancel closes it and sends nothing', () => {
      renderControls();
      fireEvent.click(killBtn()!);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it('the header Close button closes it and sends nothing', () => {
      renderControls();
      fireEvent.click(killBtn()!);
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it('Escape closes it and sends nothing', () => {
      renderControls();
      fireEvent.click(killBtn()!);
      fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it('Confirm sends exactly one confirmed session-kill message and closes the modal', () => {
      renderControls();
      fireEvent.click(killBtn()!);
      fireEvent.click(screen.getByRole('button', { name: 'Kill session' }));
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith({
        type: 'agent:kill',
        agentId: 'a1',
        killSession: true,
        confirm: true,
        reqId: expect.any(String),
      });
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(useAgentStore.getState().killing).toHaveProperty('a1');
      expect(killBtn()).toBeNull();
    });

    it('renders markup in the agent name as literal text', () => {
      const evil = '<img src=x onerror=alert(1)>';
      useAgentStore.setState({ agents: [{ ...AGENT, name: evil }] });
      renderControls('a1', evil);
      fireEvent.click(killBtn()!);
      const dlg = screen.getByRole('alertdialog');
      expect(dlg.textContent).toContain(evil);
      expect(dlg.querySelector('img')).toBeNull();
    });
  });
});

describe('DestructiveSafetyModal defaults', () => {
  it('still renders the broadcast copy when no copy props are given', () => {
    render(
      <DestructiveSafetyModal
        isOpen
        command="rm -rf /tmp/x"
        targetAgents={[AGENT]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Destructive Command Warning')).toBeTruthy();
    expect(screen.getByText('Confirm Broadcast')).toBeTruthy();
    expect(screen.getByText('Command Payload')).toBeTruthy();
  });
});
