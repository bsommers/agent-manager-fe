import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from '../layout/Header';

describe('Header Component', () => {
  it('renders title and system metric counters', () => {
    render(<Header />);

    expect(screen.getByText(/AI AGENT COMMAND CENTER/i)).toBeInTheDocument();
    expect(screen.getByText(/Multi-agent terminal operation dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Active:/i)).toBeInTheDocument();
    expect(screen.getByText(/Thinking:/i)).toBeInTheDocument();
    expect(screen.getByText(/SSH:/i)).toBeInTheDocument();
    expect(screen.getByText(/TMUX:/i)).toBeInTheDocument();
  });

  it('renders the connection status chip (DEMO under the test setup stub)', () => {
    render(<Header />);

    const chip = screen.getByTestId('connection-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('DEMO');
  });
});
