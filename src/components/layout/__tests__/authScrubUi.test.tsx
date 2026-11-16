import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { Header } from '../Header';
import { ConnectionBanner } from '../ConnectionBanner';
import { TokenDialog } from '../TokenDialog';
import { useAuthPrompt } from '../../../hooks/useAuthPrompt';
import { useAgentStore, resetAgentStore } from '../../../store/agentStore';
import { useConnectionStore } from '../../../store/connectionStore';
import { useLogBufferStore } from '../../../store/logBufferStore';
import { useUiStore, resetUiStore, initialUiState } from '../../../store/uiStore';
import { useAuthStore, clearToken, commitCandidate, TOKEN_STORAGE_KEY } from '../../../services/auth/tokenStore';
import { INITIAL_SNAPSHOT } from '../../../services/adapters/types';
import { buildCommands } from '../../../keyboard/commands';
import { agentSocket } from '../../../services/agentSocket';
import type { Agent } from '../../../types/agent';

const CANARY_1 = 'canary-ONE-Zq81vK0mXw3Rt9aB';
const CANARY_2 = 'canary-TWO-Pd47yL2nHs5Ue6cD';
const CANARIES = [CANARY_1, CANARY_2];

const consoleKinds = ['log', 'info', 'warn', 'error', 'debug'] as const;
let consoleSpies: Array<MockInstance<any[], void>>;

const Harness: React.FC = () => {
  useAuthPrompt();
  return (
    <>
      <Header />
      <ConnectionBanner />
      <TokenDialog />
    </>
  );
};

const agent = (id: string): Agent => ({
  id,
  name: `Worker ${id}`,
  mode: 'tmux',
  targetHost: 'localhost:w',
  status: 'running',
  unreadOutput: false,
  layout: { isFloating: false },
  createdAt: 1,
  lastActivity: 2,
});

function stateJson(): string {
  return JSON.stringify({
    agent: useAgentStore.getState(),
    connection: useConnectionStore.getState(),
    logBuffer: useLogBufferStore.getState(),
    ui: useUiStore.getState(),
    auth: useAuthStore.getState(),
  });
}

function inputValues(): string[] {
  return Array.from(document.querySelectorAll('input')).map((i) => i.value);
}

/** The canary must be nowhere but the single sessionStorage entry. */
function assertNoLeak(label: string, current?: string) {
  const consoleDump = JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls));
  const text = document.body.textContent ?? '';
  const state = stateJson();
  for (const c of CANARIES) {
    expect(consoleDump, `${label}: console`).not.toContain(c);
    expect(text, `${label}: document text`).not.toContain(c);
    expect(state, `${label}: store JSON`).not.toContain(c);
    // Attributes: only the password input's own value may carry it, and only while it is open.
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      for (const a of Array.from(el.attributes)) {
        if (el instanceof HTMLInputElement && a.name === 'value') continue;
        expect(a.value, `${label}: attribute ${a.name}`).not.toContain(c);
      }
    }
    // Storage values other than the token entry itself.
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) as string;
      if (k === TOKEN_STORAGE_KEY) continue;
      expect(sessionStorage.getItem(k) ?? '', `${label}: storage ${k}`).not.toContain(c);
    }
  }
  if (document.querySelector('[role="dialog"]')) {
    expect(screen.getByLabelText('Access token')).toHaveAttribute('type', 'password');
  } else {
    // Closed dialog leaves no value behind in any input.
    for (const v of inputValues()) for (const c of CANARIES) expect(v).not.toContain(c);
  }
  if (current === undefined) expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  else expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe(current);
}

const type = (v: string) =>
  fireEvent.change(screen.getByLabelText('Access token'), { target: { value: v } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

beforeEach(() => {
  consoleSpies = consoleKinds.map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
  sessionStorage.clear();
  clearToken();
  useConnectionStore.setState({ mode: 'live', state: 'connecting', lastError: null });
  resetAgentStore();
  resetUiStore();
  useLogBufferStore.getState().clearBuffer();
});

afterEach(() => {
  cleanup();
  clearToken();
  sessionStorage.clear();
  vi.restoreAllMocks();
  useConnectionStore.setState({ mode: 'demo', state: 'open', lastError: null });
  resetUiStore();
  resetAgentStore();
  useLogBufferStore.getState().clearBuffer();
});

describe('token never leaves the one sessionStorage entry across the UI flow', () => {
  it('submit, auth_failed, wrong-token resubmit, success, logout', () => {
    render(<Harness />);
    assertNoLeak('start');

    // 1. The gateway demands a token.
    act(() => useConnectionStore.setState({ state: 'auth_failed', lastError: 'Authentication failed' }));
    expect(screen.getByRole('dialog', { name: 'Authentication required' })).toBeInTheDocument();
    assertNoLeak('dialog opened');

    // 2. Submit a (wrong) token.
    type(CANARY_1);
    assertNoLeak('typed 1', undefined);
    submit();
    // Not persisted until the gateway acknowledges it (WR-03).
    assertNoLeak('submitted 1', undefined);
    expect(screen.queryByRole('dialog')).toBeNull();

    // 3. The gateway rejects it again; the dialog re-prompts.
    act(() => useConnectionStore.setState({ state: 'auth_failed', lastError: 'Authentication failed' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    assertNoLeak('failed again', undefined);

    // 4. Resubmit a different value; it succeeds.
    type(CANARY_2);
    submit();
    assertNoLeak('submitted 2', undefined);
    // hello_ack: the adapter's accepted hook persists the candidate.
    act(() => commitCandidate());
    act(() => useConnectionStore.setState({ state: 'open', lastError: null }));
    assertNoLeak('open', CANARY_2);
    expect(sessionStorage.length).toBe(1);

    // 5. Populate the session.
    act(() => {
      useAgentStore.setState({ agents: [agent('a1'), agent('a2')], activeAgentId: 'a1' });
      useLogBufferStore.getState().appendOutput('a1', 'some terminal output\n');
    });
    assertNoLeak('populated', CANARY_2);

    // 6. Log out from the header.
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    assertNoLeak('logged out', undefined);
    expect(sessionStorage.length).toBe(0);
    expect(useAgentStore.getState().agents).toEqual([]);
    expect(useAgentStore.getState().activeAgentId).toBeNull();
    expect(useLogBufferStore.getState().buffers).toEqual({});
    expect(useAuthStore.getState().hasToken).toBe(false);
    expect(useUiStore.getState().overlay).toBe('token');
    expect(useUiStore.getState().isBroadcastOpen).toBe(initialUiState.isBroadcastOpen);
    const conn = useConnectionStore.getState();
    expect(conn.mode).toBe('live');
    expect(conn.state).toBe('closed');
    expect(conn.epoch).toBe(INITIAL_SNAPSHOT.epoch);
    expect(conn.authRequired).toBe(INITIAL_SNAPSHOT.authRequired);
    expect(screen.getByRole('dialog', { name: 'Authentication required' })).toBeInTheDocument();
  });

  it('keeps sessionStorage keys to exactly the token key while a token is set', () => {
    render(<Harness />);
    act(() => useConnectionStore.setState({ state: 'auth_failed' }));
    type(CANARY_1);
    submit();
    expect(sessionStorage.length).toBe(0);
    act(() => commitCandidate());
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i) as string);
    expect(keys).toEqual(['agent-manager.token']);
  });

  it('a wrong token yields exactly one attempt per submit and no auto-retry', () => {
    vi.useFakeTimers();
    const connect = vi.spyOn(agentSocket.getAdapter(), 'connect');
    const reconnect = vi.spyOn(agentSocket.getAdapter(), 'reconnectNow');
    render(<Harness />);
    act(() => useConnectionStore.setState({ state: 'auth_failed' }));
    type(CANARY_1);
    submit();
    expect(connect).toHaveBeenCalledTimes(1);
    // The gateway rejects it: the dialog re-prompts and nothing retries on its own.
    act(() => useConnectionStore.setState({ state: 'auth_failed' }));
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(reconnect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('logout through the palette command leaves nothing behind either', () => {
    render(<Harness />);
    act(() => useConnectionStore.setState({ state: 'auth_failed' }));
    type(CANARY_1);
    submit();
    act(() => commitCandidate());
    act(() => useConnectionStore.setState({ state: 'open' }));
    act(() => {
      useAgentStore.setState({ agents: [agent('a1')], activeAgentId: 'a1' });
    });
    const logoutCmd = buildCommands().find((c) => c.id === 'auth.logout');
    expect(logoutCmd).toBeDefined();
    act(() => logoutCmd!.run());
    assertNoLeak('palette logout', undefined);
    expect(sessionStorage.length).toBe(0);
    expect(useAgentStore.getState().agents).toEqual([]);
    expect(useUiStore.getState().overlay).toBe('token');
  });

  it.todo('Copy diagnostics redacts the token (INT-10, Phase 21)');
});
