import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { logout } from '../logout';
import { agentSocket } from '../../agentSocket';
import { getToken, setToken, useAuthStore, TOKEN_STORAGE_KEY } from '../../auth/tokenStore';
import { useAgentStore, resetAgentStore } from '../../../store/agentStore';
import { useLogBufferStore } from '../../../store/logBufferStore';
import { useUiStore, initialUiState } from '../../../store/uiStore';
import { useConnectionStore } from '../../../store/connectionStore';
import { INITIAL_SNAPSHOT } from '../../adapters/types';
import { Workspace } from '../../../components/layout/Workspace';
import type { Agent } from '../../../types/agent';

const terminalDispose = vi.hoisted(() => vi.fn());
// Plain classes (not vi.fn) so vi.restoreAllMocks() in afterEach cannot blank the implementations.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon() {}
    open() {}
    write() {}
    onData() {}
    dispose() {
      terminalDispose();
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

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

const adapter = () => agentSocket.getAdapter();
let local: MemStorage;

beforeEach(() => {
  local = new MemStorage();
  vi.stubGlobal('localStorage', local);
  sessionStorage.clear();
  useConnectionStore.setState({ mode: 'live' });
  resetAgentStore();
  useLogBufferStore.getState().clearBuffer();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useConnectionStore.setState({ mode: 'demo', lastError: null });
  useUiStore.setState({ ...initialUiState });
  resetAgentStore();
  useLogBufferStore.getState().clearBuffer();
  sessionStorage.clear();
});

function populate() {
  setToken('t'.repeat(24));
  useAgentStore.setState({
    agents: [agent('a1'), agent('a2')],
    activeAgentId: 'a1',
    searchQuery: 'q',
    layoutMode: 'tiled' as never,
    rosterNotices: [{ id: 'n1', kind: 'gateway_error', title: 't', message: 'm' } as never],
  });
  useLogBufferStore.getState().appendOutput('a1', 'secret output\n');
  useUiStore.getState().openOverlay('palette');
  useConnectionStore.setState({ epoch: 'e1', authRequired: true, lastError: 'old' });
  sessionStorage.setItem('agent-manager.layout', '{}');
  sessionStorage.setItem('other.key', 'keep');
  local.setItem('agent-manager.x', '1');
  local.setItem('other.key', 'keep');
}

describe('logout (live)', () => {
  it('clears the token from memory and sessionStorage', () => {
    populate();
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).not.toBeNull();
    logout();
    expect(getToken()).toBeUndefined();
    expect(useAuthStore.getState().hasToken).toBe(false);
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('sweeps agent-manager.* from both storages and keeps foreign keys', () => {
    populate();
    logout();
    expect(sessionStorage.getItem('agent-manager.layout')).toBeNull();
    expect(sessionStorage.getItem('other.key')).toBe('keep');
    expect(local.getItem('agent-manager.x')).toBeNull();
    expect(local.getItem('other.key')).toBe('keep');
    expect(sessionStorage.length).toBe(1);
  });

  it('leaves sessionStorage empty when only app keys were present', () => {
    setToken('t'.repeat(24));
    sessionStorage.setItem('agent-manager.layout', '{}');
    logout();
    expect(sessionStorage.length).toBe(0);
  });

  it('resets the agent store, log buffer and ui store, then opens the token dialog', () => {
    populate();
    logout();
    const s = useAgentStore.getState();
    expect(s.agents).toEqual([]);
    expect(s.activeAgentId).toBeNull();
    expect(s.rosterNotices).toEqual([]);
    expect(s.searchQuery).toBe('');
    expect(s.layoutMode).toBe('grid');
    expect(useLogBufferStore.getState().buffers).toEqual({});
    const ui = useUiStore.getState();
    expect(ui.overlay).toBe('token');
    expect(ui.isBroadcastOpen).toBe(initialUiState.isBroadcastOpen);
    expect(ui.focusRequest).toEqual(initialUiState.focusRequest);
  });

  it('keeps the connection mode and clears epoch, authRequired and lastError', () => {
    populate();
    logout();
    const c = useConnectionStore.getState();
    expect(c.mode).toBe('live');
    expect(c.state).toBe('closed');
    expect(c.epoch).toBeNull();
    expect(c.authRequired).toBeNull();
    expect(c.lastError).toBeNull();
    expect(c.attempt).toBe(INITIAL_SNAPSHOT.attempt);
  });

  it('disconnects the adapter exactly once and never connects or reconnects', () => {
    populate();
    const dis = vi.spyOn(adapter(), 'disconnect');
    const con = vi.spyOn(adapter(), 'connect');
    const re = vi.spyOn(adapter(), 'reconnectNow');
    logout();
    expect(dis).toHaveBeenCalledTimes(1);
    expect(con).not.toHaveBeenCalled();
    expect(re).not.toHaveBeenCalled();
  });

  it('drops requests with clear() and never dispose(): no late create_failed notice', () => {
    vi.useFakeTimers();
    populate();
    const clear = vi.spyOn(agentSocket.requests, 'clear');
    const dispose = vi.spyOn(agentSocket.requests, 'dispose');
    useAgentStore.getState().addAgent('New', 'tmux', 'localhost:n');
    expect(Object.keys(useAgentStore.getState().pending)).toHaveLength(1);
    logout();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(useAgentStore.getState().rosterNotices).toEqual([]);
    expect(useAgentStore.getState().pending).toEqual({});
    vi.advanceTimersByTime(60_000);
    expect(useAgentStore.getState().rosterNotices).toEqual([]);
  });

  it('leaves no timer pending', () => {
    vi.useFakeTimers();
    populate();
    logout();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a throwing step does not skip the later ones and reports complete: false', () => {
    populate();
    vi.spyOn(useLogBufferStore.getState(), 'clearBuffer').mockImplementation(() => {
      throw new Error('boom');
    });
    const res = logout();
    expect(res).toEqual({ complete: false });
    expect(getToken()).toBeUndefined();
    expect(useAgentStore.getState().agents).toEqual([]);
    expect(useUiStore.getState().overlay).toBe('token');
    expect(sessionStorage.getItem('agent-manager.layout')).toBeNull();
  });

  it('a clean run reports complete: true', () => {
    populate();
    expect(logout()).toEqual({ complete: true });
  });

  it('survives storage that throws', () => {
    populate();
    vi.stubGlobal('localStorage', {
      get length(): number {
        throw new Error('denied');
      },
      key: () => null,
      removeItem: () => undefined,
    });
    const res = logout();
    expect(res.complete).toBe(false);
    expect(getToken()).toBeUndefined();
  });

  it('works when the persistent storage is undefined (Node 26 jsdom)', () => {
    populate();
    vi.stubGlobal('localStorage', undefined);
    expect(logout()).toEqual({ complete: true });
  });
});

describe('logout (demo)', () => {
  it('only clears the token: roster and dialog are untouched', () => {
    useConnectionStore.setState({ mode: 'demo' });
    resetAgentStore();
    const before = useAgentStore.getState().agents;
    setToken('t'.repeat(24));
    const dis = vi.spyOn(adapter(), 'disconnect');
    expect(logout()).toEqual({ complete: true });
    expect(getToken()).toBeUndefined();
    expect(useAgentStore.getState().agents).toBe(before);
    expect(useUiStore.getState().overlay).toBeNull();
    expect(dis).not.toHaveBeenCalled();
  });
});

describe('logout unmounts the workspace panes (A3)', () => {
  it('removes every pane and disposes each terminal', () => {
    useAgentStore.setState({ agents: [agent('w1'), agent('w2')], activeAgentId: 'w1' });
    const { queryByText } = render(React.createElement(Workspace));
    expect(queryByText(/PANE \[Worker w1\]/)).toBeInTheDocument();
    terminalDispose.mockClear();
    act(() => {
      logout();
    });
    expect(queryByText(/PANE \[Worker w1\]/)).toBeNull();
    expect(queryByText(/PANE \[Worker w2\]/)).toBeNull();
    expect(terminalDispose).toHaveBeenCalledTimes(2);
  });
});
