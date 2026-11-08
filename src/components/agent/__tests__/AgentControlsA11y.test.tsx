import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { AgentControls } from '../AgentControls';

describe('AgentControls accessible names', () => {
  afterEach(() => cleanup());

  it('names every button with the agent name when floating', () => {
    render(<AgentControls agentId="a1" agentName="Build Box" isFloating />);
    expect(screen.getByRole('button', { name: 'Send Ctrl+C to Build Box' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear Build Box terminal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dock Build Box' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close agent Build Box' })).toBeInTheDocument();
  });

  it('uses the pop-out label when docked', () => {
    render(<AgentControls agentId="a1" agentName="Build Box" isFloating={false} />);
    expect(
      screen.getByRole('button', { name: 'Pop out Build Box as floating window' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dock Build Box' })).toBeNull();
  });

  it('omits the name when agentName is not given', () => {
    render(<AgentControls agentId="a1" isFloating />);
    expect(screen.getByRole('button', { name: 'Send Ctrl+C' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear terminal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dock' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close agent' })).toBeInTheDocument();
  });

  it('gives all four buttons type button', () => {
    render(<AgentControls agentId="a1" agentName="Build Box" isFloating />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    for (const b of buttons) expect(b).toHaveAttribute('type', 'button');
  });

  it('keeps existing titles unchanged', () => {
    const { rerender } = render(<AgentControls agentId="a1" agentName="X" isFloating />);
    expect(screen.getByTitle('Send SIGINT (Ctrl+C)')).toBeInTheDocument();
    expect(screen.getByTitle('Dock Window')).toBeInTheDocument();
    expect(screen.getByTitle('Close Agent')).toBeInTheDocument();
    rerender(<AgentControls agentId="a1" agentName="X" isFloating={false} />);
    expect(screen.getByTitle('Pop out Floating Window')).toBeInTheDocument();
  });

  it('contains the visible text of the text buttons in their accessible names', () => {
    render(<AgentControls agentId="a1" agentName="Build Box" isFloating />);
    expect(screen.getByRole('button', { name: /Ctrl\+C/ })).toHaveTextContent('Ctrl+C');
    const clear = screen.getByText('Clear').closest('button')!;
    expect(clear.getAttribute('aria-label')).toContain('Clear');
  });

  it('renders a markup-bearing name as literal attribute text and creates no element', () => {
    const { container } = render(
      <AgentControls agentId="a1" agentName={'<img src=x onerror=alert(1)>'} isFloating />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Close agent <img src=x onerror=alert(1)>' })
    ).toBeInTheDocument();
  });
});
