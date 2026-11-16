#!/usr/bin/env node
// Real-process auth smoke test (Phase 8, INT-02).
//
// Runs the BUILT gateway (server/dist/index.js) as child processes on free ports and drives it over
// WebSocket and HTTP. Unlike the in-process vitest suites it exercises process.env, resolveAuthToken
// at start-up and the process entry point's refusal exit.
//
// - The token is random per run and reaches the children only through their environment.
// - The token is never printed; every child's output is searched for it at the end.
// - It never uses a fixed port, and it only signals children it started itself.
// - Children get an empty TMUX_TMPDIR, so they cannot see (or touch) any real tmux session.
//
// Usage: npm --prefix server run build && node server/scripts/smoke-auth.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(HERE, '..');
const ENTRY = join(SERVER_DIR, 'dist', 'index.js');
const require = createRequire(join(SERVER_DIR, 'package.json'));
const WebSocket = require('ws');

const TOKEN = randomBytes(36).toString('base64url'); // 48 printable characters, never printed
const WRONG = randomBytes(36).toString('base64url');
const tmuxDir = mkdtempSync(join(tmpdir(), 'smoke-auth-tmux-'));

const children = [];
let passed = 0;
let failed = 0;

function pass(name) {
  passed += 1;
  console.log(`PASS ${name}`);
}

function fail(name, detail) {
  failed += 1;
  console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
}

/** Checks never include the token in a message; detail strings are built from codes and keys only. */
function check(name, ok, detail) {
  if (ok) pass(name);
  else fail(name, detail);
  return ok;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

/**
 * Spawns the built gateway. `env` overrides on top of a scrubbed copy of this process's
 * environment (inherited gateway variables are removed first). Resolves when the listening line
 * appears or the process exits.
 */
function startGateway(env) {
  const base = { ...process.env, NODE_ENV: 'production', TMUX_TMPDIR: tmuxDir };
  for (const key of ['AGENT_MANAGER_TOKEN', 'AGENT_MANAGER_TRUST_PROXY', 'HOST', 'PORT', 'ALLOWED_ORIGINS']) {
    delete base[key];
  }
  const child = spawn(process.execPath, [ENTRY], {
    cwd: SERVER_DIR,
    env: { ...base, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = { child, output: '', exited: false, code: null, signal: null };
  children.push(record);
  child.stdout.on('data', (d) => (record.output += d.toString()));
  child.stderr.on('data', (d) => (record.output += d.toString()));
  return new Promise((resolveStart) => {
    const finish = (listening) => resolveStart({ ...record, record, listening });
    child.once('exit', (code, signal) => {
      record.exited = true;
      record.code = code;
      record.signal = signal;
      finish(false);
    });
    const timer = setInterval(() => {
      if (record.output.includes('listening on')) {
        clearInterval(timer);
        finish(true);
      }
    }, 25);
    setTimeout(() => {
      clearInterval(timer);
      finish(record.output.includes('listening on'));
    }, 15000).unref();
  });
}

function stop(record) {
  return new Promise((resolveStop) => {
    if (record.exited) return resolveStop();
    record.child.once('exit', () => resolveStop());
    record.child.kill('SIGTERM');
    setTimeout(() => {
      if (!record.exited) record.child.kill('SIGKILL');
    }, 3000).unref();
  });
}

/**
 * Opens a socket, optionally sends one frame, and records everything until close.
 * Resolves { frames, code, reason, ms } or { error }.
 */
function wsSession(port, { send, waitMs = 10000 } = {}) {
  return new Promise((resolveSession) => {
    const started = Date.now();
    const frames = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => {
      ws.terminate();
      resolveSession({ error: 'timeout', frames });
    }, waitMs);
    ws.on('open', () => {
      if (send !== undefined) ws.send(JSON.stringify(send));
    });
    ws.on('message', (data) => {
      try {
        frames.push(JSON.parse(data.toString()));
      } catch {
        frames.push({ type: '<unparseable>' });
      }
    });
    ws.on('error', () => {});
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolveSession({ frames, code, reason: reason.toString(), ms: Date.now() - started });
    });
  });
}

/** Opens a socket, sends a hello, and resolves after `settleMs` with the frames seen (socket kept open). */
function wsHelloAndWait(port, hello, settleMs) {
  return new Promise((resolveSession) => {
    const frames = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    let closed = null;
    const timer = setTimeout(() => {
      ws.close();
      resolveSession({ frames, closed });
    }, settleMs);
    ws.on('open', () => ws.send(JSON.stringify(hello)));
    ws.on('message', (data) => {
      try {
        frames.push(JSON.parse(data.toString()));
      } catch {
        frames.push({ type: '<unparseable>' });
      }
    });
    ws.on('error', () => {});
    ws.on('close', (code) => {
      closed = code;
      clearTimeout(timer);
      resolveSession({ frames, closed });
    });
  });
}

// `contract` is required by the hello shape; a hello without it is malformed, not a wrong token.
const hello = (token) => ({ type: 'hello', contract: 1, token });

async function main() {
  if (!existsSync(ENTRY)) {
    console.error('server/dist/index.js is missing: run `npm --prefix server run build` first.');
    process.exit(2);
  }

  // 1. Refusal: non-loopback HOST without a token.
  {
    const port = await freePort();
    const r = await startGateway({ HOST: '0.0.0.0', PORT: String(port) });
    await stop(r.record);
    check(
      '1 refusal: HOST=0.0.0.0 without a token exits non-zero and names HOST and AGENT_MANAGER_TOKEN',
      !r.listening && r.record.code !== 0 && r.record.code !== null &&
        r.record.output.includes('AGENT_MANAGER_TOKEN') && r.record.output.includes('HOST'),
      `exit=${r.record.code} listening=${r.listening}`
    );
  }

  // 2. Refusal: a 10-character token.
  {
    const short = randomBytes(8).toString('base64url').slice(0, 10);
    const port = await freePort();
    const r = await startGateway({ PORT: String(port), AGENT_MANAGER_TOKEN: short });
    await stop(r.record);
    check(
      '2 refusal: a 10-character token exits non-zero, states the length rule, never echoes the value',
      !r.listening && r.record.code !== 0 && r.record.code !== null &&
        r.record.output.includes('24 to 512') && !r.record.output.includes(short),
      `exit=${r.record.code} listening=${r.listening}`
    );
  }

  // 3. A valid token on loopback listens.
  const port = await freePort();
  const gw = await startGateway({ PORT: String(port), AGENT_MANAGER_TOKEN: TOKEN });
  if (!check('3 with a valid token on loopback the gateway listens', gw.listening, `exit=${gw.record.code}`)) {
    throw new Error('gateway did not start; cannot continue');
  }

  // 4. WS wrong token: closed 4401, no frame.
  {
    const s = await wsSession(port, { send: hello(WRONG) });
    check(
      '4 WS wrong hello token is closed 4401 with no frame received',
      s.code === 4401 && s.frames.length === 0,
      `code=${s.code} frames=${s.frames?.length} ${s.error ?? ''}`
    );
  }

  // 5. WS right token: hello_ack (auth.required true, epoch) then agent:init_list.
  {
    const s = await wsHelloAndWait(port, hello(TOKEN), 1200);
    const [first, second] = s.frames;
    check(
      '5 WS right token yields hello_ack (auth.required, epoch) then agent:init_list',
      first?.type === 'hello_ack' &&
        first.auth?.required === true &&
        typeof first.epoch === 'string' && first.epoch.length > 0 &&
        second?.type === 'agent:init_list',
      `frames=${s.frames.map((f) => f.type).join(',')} closed=${s.closed}`
    );
  }

  // 6. WS silent: closed 4401 near the 5 s deadline, no frame.
  {
    const s = await wsSession(port, { waitMs: 12000 });
    check(
      '6 WS silent socket is closed 4401 between 4.5 s and 7 s with no frame',
      s.code === 4401 && s.frames.length === 0 && s.ms >= 4500 && s.ms <= 7000,
      `code=${s.code} ms=${s.ms} frames=${s.frames?.length} ${s.error ?? ''}`
    );
  }

  // 7. HTTP (before any throttle lock): Bearer rules and health forms.
  {
    const base = `http://127.0.0.1:${port}`;
    const noHeader = await fetch(`${base}/api/agents`);
    const bearer = { Authorization: `Bearer ${TOKEN}` };
    const withHeader = await fetch(`${base}/api/agents`, { headers: bearer });
    const health = await fetch(`${base}/api/health`);
    const healthBody = await health.json();
    const legacy = await fetch(`${base}/health`);
    const legacyBody = await legacy.json();
    check(
      '7 HTTP: /api/agents 401 without a header and 200 with the Bearer; /api/health minimal; /health has no agents',
      noHeader.status === 401 &&
        noHeader.headers.get('www-authenticate') === 'Bearer' &&
        withHeader.status === 200 &&
        health.status === 200 && healthBody.ok === true && !('agents' in healthBody) &&
        legacy.status === 200 && !('agents' in legacyBody),
      `noHeader=${noHeader.status} withHeader=${withHeader.status} health=${health.status} legacy=${legacy.status}`
    );
  }

  // 8. Throttle, in its own child on its own port so it cannot disturb checks 3 to 7.
  {
    const tport = await freePort();
    const t = await startGateway({ PORT: String(tport), AGENT_MANAGER_TOKEN: TOKEN });
    if (!t.listening) {
      fail('8 throttle: gateway did not start', `exit=${t.record.code}`);
    } else {
      let ok = true;
      for (let i = 0; i < 5; i += 1) {
        const s = await wsSession(tport, { send: hello(WRONG), waitMs: 5000 });
        if (s.code !== 4401) ok = false;
      }
      const locked = await wsSession(tport, { send: hello(WRONG), waitMs: 5000 });
      check(
        '8 throttle: after five wrong tokens the next connection is closed 4429 with retry-after-ms=',
        ok && locked.code === 4429 && locked.reason.startsWith('retry-after-ms='),
        `fiveWrongAll4401=${ok} next=${locked.code} reason=${locked.reason}`
      );
    }
  }

  // 9. The token (and its first 12 characters) appear in no child's output.
  {
    await Promise.all(children.map((c) => stop(c)));
    const prefix = TOKEN.slice(0, 12);
    const leaked = children.filter((c) => c.output.includes(TOKEN) || c.output.includes(prefix));
    check(
      '9 the token and its 12-character prefix appear in no child stdout or stderr',
      leaked.length === 0,
      `${leaked.length} of ${children.length} children leaked`
    );
  }
}

try {
  await main();
} catch (err) {
  fail('smoke aborted', err instanceof Error ? err.message.replaceAll(TOKEN, '[token]') : 'unknown error');
} finally {
  await Promise.all(children.map((c) => stop(c)));
  rmSync(tmuxDir, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed >= 9 ? 0 : 1);
