import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import App from './App';
import { useConnectionStore } from './store/connectionStore';
import { resetUiStore } from './store/uiStore';

describe('App Integration Test', () => {
  it('renders the complete AI Agent Manager HUD layout without crashing', () => {
    render(<App />);

    expect(screen.getByText(/AI AGENT COMMAND CENTER/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search agents by name or host/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Agent/i })).toBeInTheDocument();
  });

  it('shows the Demo mode banner under the test setup stub', () => {
    render(<App />);

    expect(screen.getByText('Demo mode')).toBeInTheDocument();
  });

  describe('token dialog wiring', () => {
    afterEach(() => {
      cleanup();
      resetUiStore();
      useConnectionStore.setState({ mode: 'demo', state: 'open' });
    });

    it('does not render the dialog in the default (demo) configuration', () => {
      render(<App />);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('shows the dialog after mount when a live connection is already auth_failed', () => {
      useConnectionStore.setState({ mode: 'live', state: 'auth_failed' });
      render(<App />);
      expect(screen.getByRole('dialog', { name: 'Authentication required' })).toBeInTheDocument();
    });
  });
});
