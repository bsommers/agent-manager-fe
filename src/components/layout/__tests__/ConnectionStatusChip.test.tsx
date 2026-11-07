import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConnectionStatusChip } from '../ConnectionStatusChip';
import { useConnectionStore } from '../../../store/connectionStore';
import type { ConnState } from '../../../services/adapters/types';

afterEach(() => {
  cleanup();
  useConnectionStore.getState().reset();
});

describe('ConnectionStatusChip', () => {
  it('renders DEMO with a simulated-output title in demo mode regardless of state', () => {
    useConnectionStore.setState({ mode: 'demo', state: 'closed' });
    render(<ConnectionStatusChip />);
    const chip = screen.getByTestId('connection-chip');
    expect(chip).toHaveTextContent('DEMO');
    expect(chip.getAttribute('title')).toMatch(/simulated/i);
    expect(chip).toHaveAttribute('data-mode', 'demo');
    expect(chip).toHaveAttribute('data-state', 'closed');
  });

  const cases: Array<[ConnState, number, string, string]> = [
    ['open', 0, 'Connected', 'emerald'],
    ['connecting', 0, 'Connecting', 'amber'],
    ['reconnecting', 3, 'Reconnecting (attempt 3)', 'amber'],
    ['closed', 0, 'Disconnected', 'red'],
    ['auth_failed', 0, 'Auth failed', 'red'],
  ];

  it.each(cases)('renders live state %s', (state, attempt, text, color) => {
    useConnectionStore.setState({ mode: 'live', state, attempt });
    render(<ConnectionStatusChip />);
    const chip = screen.getByTestId('connection-chip');
    expect(chip).toHaveTextContent(text);
    expect(chip).toHaveAttribute('role', 'status');
    expect(chip).toHaveAttribute('aria-live', 'polite');
    expect(chip).toHaveAttribute('data-state', state);
    expect(chip).toHaveAttribute('data-mode', 'live');
    expect(chip.className).toContain(color);
  });

  it('renders safely with store defaults', () => {
    render(<ConnectionStatusChip />);
    expect(screen.getByTestId('connection-chip')).toHaveTextContent('Connecting');
  });
});
