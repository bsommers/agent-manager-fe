// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseClientMessage, parseServerMessage, CLIENT_TABLE, SERVER_TABLE } from '../index.js';

type Fixture = { name: string; message: Record<string, unknown> };
type Invalid = {
  name: string;
  direction: 'client' | 'server';
  input: unknown;
  reason: string;
  field?: string;
};

const load = <T>(file: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../fixtures/${file}`, import.meta.url)), 'utf8')) as T;

const client = load<Fixture[]>('client.json');
const server = load<Fixture[]>('server.json');
const invalid = load<Invalid[]>('invalid.json');

describe('client fixtures', () => {
  it.each(client.map((f) => [f.name, f.message] as const))('%s round-trips unchanged', (_name, message) => {
    const r = parseClientMessage(message);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg).toEqual(message);
  });
});

describe('server fixtures', () => {
  it.each(server.map((f) => [f.name, f.message] as const))('%s round-trips unchanged', (_name, message) => {
    const r = parseServerMessage(message);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg).toEqual(message);
  });
});

describe('invalid fixtures', () => {
  it.each(invalid.map((f) => [f.name, f] as const))('%s is rejected with the stated reason', (_name, f) => {
    const r = f.direction === 'client' ? parseClientMessage(f.input) : parseServerMessage(f.input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(f.reason);
      if (f.field !== undefined) expect(r.field).toBe(f.field);
    }
  });
});

describe('fixture coverage', () => {
  const types = (list: Fixture[]) => [...new Set(list.map((f) => f.message.type as string))].sort();
  it('every client table row has a fixture and vice versa', () => {
    expect(types(client)).toEqual(Object.keys(CLIENT_TABLE).sort());
  });
  it('every server table row has a fixture and vice versa', () => {
    expect(types(server)).toEqual(Object.keys(SERVER_TABLE).sort());
  });
});
