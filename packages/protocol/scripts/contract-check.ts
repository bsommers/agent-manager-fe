/**
 * Contract drift gate.
 *
 *   npm run contract:check -- --base <git-ref>     (default HEAD)
 *
 * Exit codes:
 *   0  contract is current and no unaccepted breaking change relative to the base
 *   1  committed snapshot is stale, or a breaking change was made without raising CONTRACT_VERSION
 *   2  usage error: bad or unknown argument, unsafe or unresolvable ref, unreadable base snapshot
 *
 * Git is only ever run through an argv array (never a shell), only to read, and only after the ref passed
 * the conservative pattern in isSafeGitRef (which also rejects a leading hyphen, i.e. option injection).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeSurface, evaluate, isSafeGitRef, serializeSurface } from '../src/index.js';
import type { Surface } from '../src/index.js';

const SNAPSHOT_REPO_PATH = 'packages/protocol/contract.snapshot.json';
const SNAPSHOT_FILE = fileURLToPath(new URL('../contract.snapshot.json', import.meta.url));

function usage(message: string): never {
  console.error(`contract-check: ${message}`);
  console.error('usage: contract-check [--base <git-ref>]');
  process.exit(2);
}

function parseArgs(args: string[]): { base: string } {
  let base = 'HEAD';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--base') {
      const value = args[i + 1];
      if (value === undefined) usage('--base needs a value');
      base = value;
      i++;
    } else if (arg.startsWith('--base=')) {
      base = arg.slice('--base='.length);
    } else {
      usage(`unknown argument ${JSON.stringify(arg.slice(0, 64))}`);
    }
  }
  if (!isSafeGitRef(base)) usage('--base is not a valid git ref (letters, digits and . _ / ~ ^ @ - only, no leading hyphen)');
  return { base };
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

function main(): void {
  const { base } = parseArgs(process.argv.slice(2));

  const live = describeSurface();
  let committed: string;
  try {
    committed = readFileSync(SNAPSHOT_FILE, 'utf8');
  } catch {
    console.error(`contract-check: ${SNAPSHOT_REPO_PATH} is missing. Run npm run contract:update.`);
    process.exit(1);
  }
  if (committed !== serializeSurface(live)) {
    console.error(
      `contract-check: ${SNAPSHOT_REPO_PATH} is stale: it does not match the contract in packages/protocol/src.\n` +
        'Run npm run contract:update, review the diff and commit it.',
    );
    process.exit(1);
  }

  try {
    git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  } catch {
    console.error(`contract-check: cannot resolve git ref ${JSON.stringify(base)} (fetch it, or pass --base <ref>).`);
    process.exit(2);
  }

  let listed: string;
  try {
    listed = git(['ls-tree', '--name-only', base, '--', SNAPSHOT_REPO_PATH]).trim();
  } catch {
    console.error(`contract-check: could not read the tree at ${JSON.stringify(base)}.`);
    process.exit(2);
  }
  if (listed === '') {
    console.log(`contract-check: ${base} has no contract snapshot (new package); nothing to compare. OK.`);
    return;
  }

  let prev: Surface;
  try {
    prev = JSON.parse(git(['show', `${base}:${SNAPSHOT_REPO_PATH}`])) as Surface;
  } catch {
    console.error(`contract-check: the snapshot at ${JSON.stringify(base)} could not be read as JSON.`);
    process.exit(2);
  }

  const result = evaluate(prev, live);
  for (const line of result.additive) console.log(`additive: ${line}`);
  for (const line of result.notices) console.log(`notice: ${line}`);
  if (!result.pass) {
    for (const line of result.breaking) console.error(`BREAKING: ${line}`);
    console.error(
      `contract-check: FAILED. Breaking changes relative to ${base} require raising CONTRACT_VERSION ` +
        `(currently ${live.contract}, base ${prev.contract}).`,
    );
    process.exit(1);
  }
  console.log(`contract-check: OK relative to ${base}.`);
}

main();
