import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App Integration Test', () => {
  it('renders the complete AI Agent Manager HUD layout without crashing', () => {
    render(<App />);

    expect(screen.getByText(/AI AGENT COMMAND CENTER/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search agents by name or host/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Agent/i })).toBeInTheDocument();
  });
});
