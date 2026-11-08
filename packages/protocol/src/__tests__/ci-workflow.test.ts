// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Static policy checks on .github/workflows/ci.yml (T-02-12, T-02-13). */
const text = readFileSync(fileURLToPath(new URL('../../../../.github/workflows/ci.yml', import.meta.url)), 'utf8');
const lines = text.split('\n');
const indentOf = (l: string): number => l.length - l.trimStart().length;

describe('ci.yml policy', () => {
  it('has exactly one permissions block, top-level, granting only contents: read', () => {
    const idx = lines.map((l, i) => (/^\s*permissions\s*:/.test(l) ? i : -1)).filter((i) => i >= 0);
    expect(idx).toHaveLength(1);
    expect(lines[idx[0]]).toBe('permissions:');
    const body: string[] = [];
    for (let i = idx[0] + 1; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      if (indentOf(lines[i]) === 0) break;
      body.push(lines[i].trim());
    }
    expect(body).toEqual(['contents: read']);
  });

  it('references no secrets', () => {
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/\bsecrets\s*:/);
  });

  it('pins every action to a 40-hex commit SHA with a version comment', () => {
    const uses = lines.filter((l) => /^\s*-?\s*uses\s*:/.test(l));
    expect(uses.length).toBeGreaterThanOrEqual(2);
    for (const l of uses) {
      const m = /uses:\s*(\S+)(?:\s+#\s*(\S+))?\s*$/.exec(l);
      expect(m, l).not.toBeNull();
      expect(m![1], l).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(m![2], l).toMatch(/^v\d+\.\d+\.\d+$/);
    }
  });

  it('uses only the two official actions', () => {
    const names = lines
      .filter((l) => /^\s*-?\s*uses\s*:/.test(l))
      .map((l) => /uses:\s*([^@\s]+)@/.exec(l)![1])
      .sort();
    expect(names).toEqual(['actions/checkout', 'actions/setup-node']);
  });

  it('mentions github.base_ref only under an env: block', () => {
    const hits = lines.map((l, i) => (l.includes('github.base_ref') ? i : -1)).filter((i) => i >= 0);
    expect(hits.length).toBeGreaterThan(0);
    for (const i of hits) {
      let parent = '';
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].trim() !== '' && indentOf(lines[j]) < indentOf(lines[i])) {
          parent = lines[j].trim();
          break;
        }
      }
      expect(parent, lines[i]).toBe('env:');
    }
  });

  it('never interpolates a ${{ }} expression inside a run command', () => {
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*-?\s*run\s*:/.test(lines[i])) continue;
      const base = indentOf(lines[i]);
      expect(lines[i]).not.toContain('${{');
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > base); j++) {
        expect(lines[j]).not.toContain('${{');
      }
    }
  });

  it('runs the full gate including contract:check on pull requests', () => {
    for (const cmd of [
      'npm ci',
      'npm --prefix server ci',
      'npm run build:protocol',
      'npm test',
      'npx tsc --noEmit',
      'npm run build',
      'npm --prefix server test',
      'npm --prefix server run build',
      'contract:check',
    ]) {
      expect(text, cmd).toContain(cmd);
    }
    expect(text).toContain('fetch-depth: 0');
    expect(text).toMatch(/pull_request/);
  });
});
