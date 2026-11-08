import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { agentSocket } from '../../../services/agentSocket';
import { TerminalView } from '../TerminalView';

describe('TerminalView terminal-report suppression (real xterm)', () => {
  let listener: ((msg: any) => void) | null = null;
  let sendSpy: { mock: { calls: unknown[][] } };

  beforeEach(() => {
    listener = null;
    vi.spyOn(agentSocket, 'subscribe').mockImplementation(((fn: any) => {
      listener = fn;
      return () => {};
    }) as any);
    sendSpy = vi.spyOn(agentSocket, 'send').mockReturnValue(true);
    vi.spyOn(agentSocket, 'startMockStream').mockImplementation(() => {});
    vi.spyOn(agentSocket, 'stopMockStream').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const inputs = () => sendSpy.mock.calls.map((c) => c[0] as any).filter((m) => m.type === 'agent:input');

  it('does not forward xterm query replies, but still forwards keystrokes', async () => {
    render(<TerminalView agentId="a1" agentName="Alpha" mode="tmux" targetHost="h" isActive={false} />);
    expect(listener).not.toBeNull();

    for (const data of ['\x1b[c', '\x1b[>c', '\x1b]10;?\x1b\\', '\x1b]11;?\x07']) {
      act(() => listener!({ type: 'agent:output', agentId: 'a1', data }));
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(inputs()).toEqual([]);

    const ta = screen.getByLabelText('Terminal input: Alpha');
    fireEvent.keyDown(ta, { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 });
    expect(inputs()).toEqual([{ type: 'agent:input', agentId: 'a1', data: '\x1b[A' }]);
  });
});
