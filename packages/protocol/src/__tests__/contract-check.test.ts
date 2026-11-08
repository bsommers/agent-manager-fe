// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Black-box tests of the contract-check CLI. It is spawned through argv arrays (no shell). Base refs live in
 * throwaway git repos so the failure conditions can be staged without touching this repository.
 *
 * Failure conditions under test:
 *   exit 2  unsafe/unknown/missing --base value, or a ref git cannot resolve
 *   exit 1  a breaking change (here: a required field removed) with CONTRACT_VERSION not raised
 *   exit 0  the same change when the base contract number is lower (i.e. the version was raised),
 *           an additive change, and a base that has no snapshot yet
 */

const SNAPSHOT_REL = 'packages/protocol/contract.snapshot.json';
const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../../scripts/contract-check.ts');
const liveSnapshot = readFileSync(join(here, '../../contract.snapshot.json'), 'utf8');
const viteNode = join(dirname(createRequire(import.meta.url).resolve('vite-node/package.json')), 'vite-node.mjs');

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
};

let work: string;
const repos: string[] = [];

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });
}

/** A throwaway repo whose HEAD holds `snapshot` at the contract path (or no snapshot when null). */
function makeRepo(snapshot: object | string | null): string {
  const dir = mkdtempSync(join(work, 'repo-'));
  repos.push(dir);
  git(dir, ['init', '-q']);
  if (snapshot === null) {
    writeFileSync(join(dir, 'README'), 'x\n');
  } else {
    mkdirSync(join(dir, 'packages/protocol'), { recursive: true });
    const text = typeof snapshot === 'string' ? snapshot : `${JSON.stringify(snapshot, null, 2)}\n`;
    writeFileSync(join(dir, SNAPSHOT_REL), text);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

function run(cwd: string, args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [viteNode, script, ...args], { cwd, encoding: 'utf8', env: GIT_ENV });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const liveObj = (): Record<string, any> => JSON.parse(liveSnapshot) as Record<string, any>;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'contract-check-'));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('contract-check CLI', () => {
  it('exits 2 for --base --evil (option injection) without running git', () => {
    const empty = mkdtempSync(join(work, 'nogit-'));
    const r = run(empty, ['--base', '--evil']);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/not a valid git ref/);
  });

  it.each([
    [['--base=--evil']],
    [['--base']],
    [['--base', '']],
    [['--base', 'a;b']],
    [['--base', 'a b']],
    [['--bogus']],
    [['stray']],
  ])('exits 2 for bad arguments %j', (args) => {
    const empty = mkdtempSync(join(work, 'nogit-'));
    expect(run(empty, args).status).toBe(2);
  });

  it('exits 2 when the ref cannot be resolved', () => {
    const repo = makeRepo(liveObj());
    const r = run(repo, ['--base', 'no-such-ref']);
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/cannot resolve git ref/);
  });

  it('exits 0 when the base snapshot equals the current surface', () => {
    const repo = makeRepo(liveSnapshot);
    const r = run(repo, ['--base', 'HEAD']);
    expect(r.out).toMatch(/OK relative to HEAD/);
    expect(r.status).toBe(0);
  });

  it('exits 0 when the base has no snapshot yet (new package)', () => {
    const repo = makeRepo(null);
    const r = run(repo, ['--base', 'HEAD']);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/no contract snapshot/);
  });

  it('exits 1 when a required field was removed and CONTRACT_VERSION was not raised', () => {
    const base = liveObj();
    base.client.ping.fields.legacy = { kind: 'number', required: true };
    const repo = makeRepo(base);
    const r = run(repo, ['--base', 'HEAD']);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/BREAKING: client\.ping\.legacy: field removed/);
    expect(r.out).toMatch(/require raising CONTRACT_VERSION/);
  });

  it('exits 1 when a message type was removed without a contract bump', () => {
    const base = liveObj();
    base.client['agent:legacy'] = { fields: { agentId: { kind: 'string', required: true, min: 1, max: 4 } }, rules: [] };
    const r = run(makeRepo(base), ['--base', 'HEAD']);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/client\.agent:legacy: removed/);
  });

  it('exits 0 with a notice for the same breaking change when the contract number was raised', () => {
    const base = liveObj();
    base.contract = 0;
    base.client.ping.fields.legacy = { kind: 'number', required: true };
    const r = run(makeRepo(base), ['--base', 'HEAD']);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/accepted because contract was raised/);
  });

  it('exits 0 for an additive change (a new optional field and message type)', () => {
    const base = liveObj();
    delete base.client['agent:kill'].fields.confirm;
    delete base.client.ping;
    const r = run(makeRepo(base), ['--base', 'HEAD']);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/additive: client\.ping: added/);
  });
});
