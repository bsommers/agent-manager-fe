import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { TokenDialog } from '../TokenDialog';
import { useUiStore, resetUiStore } from '../../../store/uiStore';
import { useConnectionStore } from '../../../store/connectionStore';
import { agentSocket } from '../../../services/agentSocket';
import { getToken, setToken, clearToken } from '../../../services/auth/tokenStore';

const CANARY = 'canary-TOKEN-0123456789abcdef';
let connect: MockInstance<[], void>;

/** True when the value shows up in any text node or any attribute except the password input's own value. */
function leaks(v: string): boolean {
  if (document.body.textContent?.includes(v)) return true;
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    for (const a of Array.from(el.attributes)) {
      if (el instanceof HTMLInputElement && a.name === 'value') continue;
      if (a.value.includes(v)) return true;
    }
  }
  return false;
}

const open = () => act(() => useUiStore.getState().openOverlay('token'));
const input = () => screen.getByLabelText('Access token') as HTMLInputElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

beforeEach(() => {
  sessionStorage.clear();
  connect = vi.spyOn(agentSocket.getAdapter(), 'connect');
});

afterEach(() => {
  cleanup();
  resetUiStore();
  clearToken();
  sessionStorage.clear();
  vi.restoreAllMocks();
  useConnectionStore.setState({ mode: 'demo', state: 'open' });
});

describe('TokenDialog', () => {
  it('renders nothing while closed', () => {
    render(<TokenDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a labelled modal dialog with a masked, focused input', () => {
    render(<TokenDialog />);
    open();
    const dlg = screen.getByRole('dialog', { name: 'Authentication required' });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Authentication required' })).toBeVisible();
    const el = input();
    expect(el).toHaveAttribute('type', 'password');
    expect(el).toHaveAttribute('autocomplete', 'off');
    expect(el).toHaveAttribute('spellcheck', 'false');
    expect(el).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders through the overlay portal on document.body', () => {
    render(<TokenDialog />);
    open();
    expect(screen.getByRole('dialog').closest('[data-overlay-layer]')).not.toBeNull();
  });

  it('never writes the typed value into text nodes or attributes other than the input value', () => {
    render(<TokenDialog />);
    open();
    type(CANARY);
    expect(leaks(CANARY)).toBe(false);
    expect(input().value).toBe(CANARY);
  });

  it('a valid submit stores the token, connects once, closes and discards the value', () => {
    render(<TokenDialog />);
    open();
    type(CANARY);
    submit();
    expect(getToken()).toBe(CANARY);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().overlay).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain(CANARY);
    open();
    expect(input().value).toBe('');
  });

  it('shows the disabled reason inline, stays open and stores nothing when the adapter is disabled (WR-03)', () => {
    const adapter = agentSocket.getAdapter();
    Object.defineProperty(adapter, 'disabledReason', { value: 'Backend URL is not allowed', configurable: true });
    try {
      render(<TokenDialog />);
      open();
      type(CANARY);
      submit();
      expect(screen.getByRole('alert').textContent).toBe('Backend URL is not allowed');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(connect).not.toHaveBeenCalled();
      expect(getToken()).toBeUndefined();
      expect(sessionStorage.length).toBe(0);
    } finally {
      delete (adapter as { disabledReason?: unknown }).disabledReason;
    }
  });

  it('an invalid submit shows a fixed inline alert, stays open and does not connect', () => {
    render(<TokenDialog />);
    open();
    type('has space');
    submit();
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).not.toContain('has space');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(connect).not.toHaveBeenCalled();
    expect(getToken()).toBeUndefined();
    expect(leaks('has space')).toBe(false);
  });

  it('shows the Authentication failed hint only in auth_failed', () => {
    useConnectionStore.setState({ mode: 'live', state: 'closed' });
    render(<TokenDialog />);
    open();
    expect(screen.queryByText('Authentication failed')).toBeNull();
    act(() => useConnectionStore.setState({ state: 'auth_failed' }));
    expect(screen.getByText('Authentication failed')).toBeInTheDocument();
  });

  it('Escape closes without logging out or clearing the existing token', () => {
    setToken('e'.repeat(24));
    render(<TokenDialog />);
    open();
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useUiStore.getState().overlay).toBeNull();
    expect(getToken()).toBe('e'.repeat(24));
    expect(removeSpy).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('Cancel behaves like Escape', () => {
    setToken('e'.repeat(24));
    render(<TokenDialog />);
    open();
    type(CANARY);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useUiStore.getState().overlay).toBeNull();
    expect(getToken()).toBe('e'.repeat(24));
    expect(connect).not.toHaveBeenCalled();
    open();
    expect(input().value).toBe('');
  });

  it('Tab stays inside the dialog', () => {
    render(<TokenDialog />);
    open();
    const connectBtn = screen.getByRole('button', { name: 'Connect' });
    connectBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    input().focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('no storm: a wrong token makes one attempt, then the failure re-prompts without more attempts', () => {
    useConnectionStore.setState({ mode: 'live', state: 'auth_failed' });
    render(<TokenDialog />);
    open();
    type('wrong-token-1');
    submit();
    expect(connect).toHaveBeenCalledTimes(1);
    // simulated 4401 again: dialog reopens by user action only (hook is tested separately)
    act(() => useConnectionStore.setState({ state: 'connecting' }));
    act(() => useConnectionStore.setState({ state: 'auth_failed' }));
    open();
    expect(connect).toHaveBeenCalledTimes(1);
    type('wrong-token-2');
    submit();
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
