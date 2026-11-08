// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeSurface, describeSpec, serializeSurface, LIMITS, CONTRACT_VERSION } from '../index.js';
import type { FieldSpec } from '../index.js';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('describeSurface', () => {
  it('is deterministic and byte-stable', () => {
    expect(JSON.stringify(describeSurface())).toBe(JSON.stringify(describeSurface()));
    expect(serializeSurface()).toBe(serializeSurface());
  });

  it('sorts object keys recursively', () => {
    const walk = (v: unknown, path: string): void => {
      if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, `${path}[${i}]`));
      } else if (v !== null && typeof v === 'object') {
        const keys = Object.keys(v as object);
        expect(keys, path).toEqual([...keys].sort());
        for (const k of keys) walk((v as Record<string, unknown>)[k], `${path}.${k}`);
      }
    };
    walk(describeSurface(), '$');
  });

  it('matches the committed snapshot', async () => {
    try {
      await expect(serializeSurface()).toMatchFileSnapshot('../../contract.snapshot.json');
    } catch (err) {
      throw new Error(
        `The contract surface differs from packages/protocol/contract.snapshot.json. ` +
          `Run npm run contract:update and review the diff.\n${(err as Error).message}`,
      );
    }
  });

  it('contains every section header the contract defines', () => {
    const s = describeSurface();
    expect(Object.keys(s).sort()).toEqual(
      ['agentCapabilities', 'client', 'contract', 'errorCodes', 'gatewayCapabilities', 'http', 'limits', 'operations', 'server'].sort(),
    );
    expect(s.contract).toBe(CONTRACT_VERSION);
    expect(s.limits).toMatchObject({ MAX_FRAME_BYTES: LIMITS.MAX_FRAME_BYTES, RECONNECT: { baseMs: 500 } });
  });

  it('records the Phase 9.1 agent:kill fields with killSession and confirm optional', () => {
    const kill = describeSurface().client['agent:kill'];
    expect(Object.keys(kill.fields).sort()).toEqual(['agentId', 'confirm', 'killSession', 'reqId']);
    expect(kill.fields.agentId.required).toBe(true);
    expect(kill.fields.killSession).toMatchObject({ kind: 'boolean', required: false });
    expect(kill.fields.confirm).toMatchObject({ kind: 'boolean', required: false });
    expect(kill.fields.reqId.required).toBe(false);
  });

  it('records USAGE as HTTP 400', () => {
    expect(describeSurface().errorCodes.USAGE).toBe(400);
  });

  it('records rules, nested field maps and tagged variants', () => {
    const s = describeSurface();
    expect(s.client['agent:history'].rules).toEqual([{ fields: ['beforeSeq', 'afterSeq'], kind: 'exactlyOne' }]);
    expect(s.server['agent:history_chunk'].fields.chunks.kind).toBe('array');
    expect(s.server['agent:history_chunk'].fields.chunks.fields).toBeTypeOf('object');
    expect(s.server['agent:meta'].fields.data.kind).toBe('byTag');
  });

  it('lists every message and constant that contract spec sections 4 and 8 define (read from the spec)', () => {
    const spec = read('../../../../docs/superpowers/specs/2026-11-07-fe-be-contract.md');
    const section = (from: string, to: string): string => spec.slice(spec.indexOf(from), spec.indexOf(to));
    const types = (text: string): string[] =>
      [...text.matchAll(/^\| `([a-z_:]+)` \|/gm)].map((m) => m[1]).filter((t) => t !== 'type').sort();
    const s = describeSurface();
    expect(types(section('### 4.1', '### 4.2'))).toEqual(Object.keys(s.client).sort());
    expect(types(section('### 4.2', '## 5.'))).toEqual(Object.keys(s.server).sort());
    const constants = [...section('## 8.', '## 9.').matchAll(/^\| `([A-Z_]+)` \|/gm)]
      .map((m) => m[1])
      .filter((c) => c !== 'CONTRACT_VERSION');
    for (const c of constants) expect(s.limits, c).toHaveProperty(c);
    for (const key of ['agent:input', 'hello', 'agent:history_chunk', 'agent:meta']) {
      expect(JSON.stringify(s)).toContain(key);
    }
  });

  it('covers every HTTP body kind', () => {
    expect(Object.keys(describeSurface().http).sort()).toEqual(
      ['agent', 'agents', 'error', 'health', 'logs', 'ok', 'search'],
    );
  });
});

describe('describeSpec', () => {
  it('throws on a field-spec kind the surface does not know', () => {
    const bogus = { kind: 'quantum' } as unknown as FieldSpec;
    expect(() => describeSpec(bogus)).toThrow(/unsupported field-spec kind "quantum"/);
  });
});
