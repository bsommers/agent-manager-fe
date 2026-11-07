import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DestructiveSafetyModal } from '../DestructiveSafetyModal';
import { Agent } from '../../../types/agent';

const makeAgent = (id: string, name: string): Agent => ({
  id,
  name,
  mode: 'tmux',
  targetHost: `localhost:${id}`,
  status: 'running',
  unreadOutput: false,
  layout: { isFloating: false },
  createdAt: 1,
  lastActivity: 1,
});

const targets = [makeAgent('a1', 'Alpha'), makeAgent('a2', 'Beta')];

const Harness: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>open-destructive</button>
      <DestructiveSafetyModal
        isOpen={open}
        command="rm -rf /tmp/x"
        targetAgents={targets}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      />
    </div>
  );
};

describe('DestructiveSafetyModal accessibility', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing and registers no keydown listener when closed', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const { container } = render(
      <DestructiveSafetyModal isOpen={false} command="x" targetAgents={targets} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(addSpy.mock.calls.filter((c) => c[0] === 'keydown')).toHaveLength(0);
  });

  it('is a labelled modal alertdialog described by the target count', () => {
    render(
      <DestructiveSafetyModal isOpen command="rm -rf /" targetAgents={targets} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Destructive Command Warning' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/sent simultaneously to 2 targeted agent sessions/i);
  });

  it('opens with focus on Cancel, not Confirm Broadcast', () => {
    render(
      <DestructiveSafetyModal isOpen command="rm -rf /" targetAgents={targets} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Confirm Broadcast' })).not.toHaveFocus();
  });

  it('a stray Enter on open cancels and never confirms', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);
    const opener = screen.getByText('open-destructive');
    opener.focus();
    await user.click(opener);
    await user.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onCancel once and never onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DestructiveSafetyModal isOpen command="x" targetAgents={targets} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('wraps Tab across Close, Cancel and Confirm Broadcast', async () => {
    const user = userEvent.setup();
    render(
      <DestructiveSafetyModal isOpen command="x" targetAgents={targets} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Confirm Broadcast' });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });

  it('returns focus to the opener after closing', async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={() => {}} onCancel={() => {}} />);
    const opener = screen.getByText('open-destructive');
    opener.focus();
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
