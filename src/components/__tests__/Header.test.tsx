import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { Header } from '../layout/Header';
import { setToken, clearToken } from '../../services/auth/tokenStore';
import { logout } from '../../services/session/logout';

vi.mock('../../services/session/logout', () => ({ logout: vi.fn(() => ({ complete: true })) }));

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

  describe('Log out button (D-04)', () => {
    afterEach(() => {
      act(() => clearToken());
      vi.mocked(logout).mockClear();
    });

    it('is absent without a token', () => {
      render(<Header />);
      expect(screen.queryByRole('button', { name: /log out/i })).toBeNull();
    });

    it('appears once a token is set and calls logout on click', () => {
      render(<Header />);
      act(() => {
        setToken('a'.repeat(24));
      });
      const btn = screen.getByRole('button', { name: 'Log out' });
      fireEvent.click(btn);
      expect(logout).toHaveBeenCalledTimes(1);
    });

    it('disappears again after the token is cleared', () => {
      render(<Header />);
      act(() => {
        setToken('a'.repeat(24));
      });
      expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
      act(() => clearToken());
      expect(screen.queryByRole('button', { name: /log out/i })).toBeNull();
    });
  });
});
