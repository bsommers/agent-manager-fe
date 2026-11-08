import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { DestructiveSafetyModal } from '../DestructiveSafetyModal';
import type { Agent } from '../../../types/agent';

const mk = (id: string, name: string): Agent => ({
  id,
  name,
  mode: 'tmux',
  targetHost: `localhost:${id}`,
  status: 'running',
  unreadOutput: false,
  layout: { isFloating: false },
  createdAt: 1,
  lastActivity: 2,
});

const TWO = [mk('a', 'Alpha'), mk('b', 'Beta')];

const renderModal = (props: Partial<React.ComponentProps<typeof DestructiveSafetyModal>> = {}) =>
  render(
    <DestructiveSafetyModal
      isOpen
      command="rm -rf /tmp/x"
      targetAgents={TWO}
      onConfirm={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  );

describe('DestructiveSafetyModal copy contract', () => {
  describe('defaults (broadcast copy)', () => {
    it('renders the exact default strings', () => {
      renderModal();
      const dlg = screen.getByRole('alertdialog');
      expect(within(dlg).getByText('Destructive Command Warning')).toBeTruthy();
      expect(
        within(dlg).getByText('Potentially destructive operations detected in broadcast payload'),
      ).toBeTruthy();
      expect(within(dlg).getByText('Command Payload')).toBeTruthy();
      expect(within(dlg).getByText('Targeted Sessions (2)')).toBeTruthy();
      expect(within(dlg).getByText('Confirm Broadcast')).toBeTruthy();
      expect(dlg.textContent).toContain(
        'This command will be sent simultaneously to 2 targeted agent sessions. Are you sure you want to execute?',
      );
    });

    it('uses the singular for one agent', () => {
      renderModal({ targetAgents: [TWO[0]] });
      expect(screen.getByRole('alertdialog').textContent).toContain(
        'This command will be sent simultaneously to 1 targeted agent session. Are you sure you want to execute?',
      );
      expect(screen.getByText('Targeted Sessions (1)')).toBeTruthy();
    });

    it('names the dialog with the default title and focuses Cancel', () => {
      renderModal();
      expect(screen.getByRole('alertdialog', { name: 'Destructive Command Warning' })).toBeTruthy();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });
  });

  describe('overrides', () => {
    it('title replaces the heading and becomes the accessible name', () => {
      renderModal({ title: 'Kill tmux session' });
      expect(screen.getByRole('alertdialog', { name: 'Kill tmux session' })).toBeTruthy();
      expect(screen.queryByText('Destructive Command Warning')).toBeNull();
    });

    it('subtitle replaces the default subtitle', () => {
      renderModal({ subtitle: 'Custom subtitle' });
      expect(screen.getByText('Custom subtitle')).toBeTruthy();
      expect(screen.queryByText(/detected in broadcast payload/)).toBeNull();
    });

    it('body replaces the whole sentence', () => {
      renderModal({ body: 'Custom body text.' });
      const dlg = screen.getByRole('alertdialog');
      expect(dlg.textContent).toContain('Custom body text.');
      expect(dlg.textContent).not.toContain('sent simultaneously');
    });

    it('body is also the accessible description', () => {
      renderModal({ body: 'Custom body text.' });
      expect(screen.getByRole('alertdialog', { description: 'Custom body text.' })).toBeTruthy();
    });

    it('commandLabel replaces Command Payload', () => {
      renderModal({ commandLabel: 'Command the gateway will run' });
      expect(screen.getByText('Command the gateway will run')).toBeTruthy();
      expect(screen.queryByText('Command Payload')).toBeNull();
    });

    it('targetsLabel replaces the counted label', () => {
      renderModal({ targetsLabel: 'Agent that will be removed' });
      expect(screen.getByText('Agent that will be removed')).toBeTruthy();
      expect(screen.queryByText(/Targeted Sessions/)).toBeNull();
    });

    it('confirmLabel replaces Confirm Broadcast', () => {
      renderModal({ confirmLabel: 'Kill session' });
      expect(screen.getByRole('button', { name: 'Kill session' })).toBeTruthy();
      expect(screen.queryByText('Confirm Broadcast')).toBeNull();
    });

    it('overridden copy keeps Cancel, Close and Escape cancel-only', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      renderModal({ title: 'T', confirmLabel: 'Do it', onConfirm, onCancel });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledTimes(3);
      expect(onConfirm).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('markup safety', () => {
    it('renders markup-bearing title, subtitle, command and labels as literal text', () => {
      const evil = '<img src=x onerror=alert(1)>';
      renderModal({
        title: evil,
        subtitle: evil,
        body: evil,
        command: evil,
        commandLabel: evil,
        targetsLabel: evil,
        confirmLabel: evil,
      });
      const dlg = screen.getByRole('alertdialog');
      expect(dlg.querySelector('img')).toBeNull();
      expect(dlg.textContent).toContain(evil);
      expect(screen.getByRole('alertdialog', { name: evil })).toBeTruthy();
    });
  });

  it('renders nothing when closed', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
