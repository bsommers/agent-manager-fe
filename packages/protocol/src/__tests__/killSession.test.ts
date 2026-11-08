// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseClientMessage, parseServerMessage } from '../index.js';
import type { WSMessageClient } from '../index.js';

const fixture = <T>(file: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/${file}`, import.meta.url)), 'utf8')) as T;

describe('agent:kill killSession and confirm', () => {
  it('accepts killSession true with confirm true, unchanged', () => {
    const msg = { type: 'agent:kill', agentId: 'a1', killSession: true, confirm: true };
    const r = parseClientMessage(msg);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg).toEqual(msg);
  });

  it('accepts killSession false and confirm false, unchanged', () => {
    const msg = { type: 'agent:kill', agentId: 'a1', killSession: false, confirm: false };
    const r = parseClientMessage(msg);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg).toEqual(msg);
  });

  it('accepts the message without either field and keeps the keys absent', () => {
    const r = parseClientMessage({ type: 'agent:kill', agentId: 'a1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.msg).toEqual({ type: 'agent:kill', agentId: 'a1' });
      expect('killSession' in r.msg).toBe(false);
      expect('confirm' in r.msg).toBe(false);
    }
  });

  it('accepts killSession true without confirm (the gateway enforces the gate, not the validator)', () => {
    const msg = { type: 'agent:kill', agentId: 'a1', killSession: true };
    const r = parseClientMessage(msg);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg).toEqual(msg);
  });

  it('still strips unknown extra fields', () => {
    const r = parseClientMessage({
      type: 'agent:kill',
      agentId: 'a1',
      killSession: true,
      confirm: true,
      sessionName: 'evil',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg).toEqual({ type: 'agent:kill', agentId: 'a1', killSession: true, confirm: true });
  });

  it.each([
    ['killSession', 'yes'],
    ['killSession', 1],
    ['killSession', null],
    ['killSession', {}],
    ['confirm', 'yes'],
    ['confirm', 1],
    ['confirm', null],
    ['confirm', {}],
  ])('rejects %s = %j as invalid_field naming the field', (field, value) => {
    const r = parseClientMessage({ type: 'agent:kill', agentId: 'a1', [field]: value });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid_field');
      expect(r.field).toBe(field);
    }
  });

  it('type-checks: the literal is assignable to WSMessageClient', () => {
    const msg: WSMessageClient = { type: 'agent:kill', agentId: 'a1', killSession: true, confirm: true };
    expect(msg.type).toBe('agent:kill');
  });

  it('the typed USAGE refusal is a valid agent:error', () => {
    const r = parseServerMessage({
      type: 'agent:error',
      agentId: 'a1',
      code: 'USAGE',
      message: 'killSession requires confirm: true',
      retryable: false,
    });
    expect(r.ok).toBe(true);
  });

  it('has the new fixtures', () => {
    const names = fixture<{ name: string }[]>('client.json').map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['kill-session', 'kill-session-unconfirmed', 'kill-session-false']));
    const invalid = fixture<{ name: string; field?: string }[]>('invalid.json');
    expect(invalid.find((f) => f.name === 'kill-session-not-boolean')?.field).toBe('killSession');
    expect(invalid.find((f) => f.name === 'confirm-not-boolean')?.field).toBe('confirm');
  });
});
