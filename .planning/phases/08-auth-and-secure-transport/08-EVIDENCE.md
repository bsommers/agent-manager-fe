# Phase 8 Evidence: Auth and Secure Transport

- Git base SHA: 13baf36 (plan 08-05 work on top)
- Date: 2026-11-15
- Script: `server/scripts/smoke-auth.mjs` (runs the built `server/dist/index.js` as child processes on free ports; the token is random per run, passed only through the child environment, never printed; children get an empty `TMUX_TMPDIR`)

## A. Real-process smoke (INT-02)

Command: `npm --prefix server run build && node server/scripts/smoke-auth.mjs` (exit 0)

```
PASS 1 refusal: HOST=0.0.0.0 without a token exits non-zero and names HOST and AGENT_MANAGER_TOKEN
PASS 2 refusal: a 10-character token exits non-zero, states the length rule, never echoes the value
PASS 3 with a valid token on loopback the gateway listens
PASS 4 WS wrong hello token is closed 4401 with no frame received
PASS 5 WS right token yields hello_ack (auth.required, epoch) then agent:init_list
PASS 6 WS silent socket is closed 4401 between 4.5 s and 7 s with no frame
PASS 7 HTTP: /api/agents 401 without a header and 200 with the Bearer; /api/health minimal; /health has no agents
PASS 8 throttle: after five wrong tokens the next connection is closed 4429 with retry-after-ms=
PASS 9 the token and its 12-character prefix appear in no child stdout or stderr
9 passed, 0 failed
```

Process check (`pgrep -f '^node .*server/dist/index.js' | wc -l`): 0 before, 0 after. (An unanchored `pgrep -f 'server/dist/index.js'` reports 1 because it matches the invoking shell's own command line; the anchored form excludes it.)

Port check: the script contains no fixed port. `grep -c 8088 server/scripts/smoke-auth.mjs` prints 0. Every child binds a port found by listening on port 0.

Note on a first-run script bug (fixed before commit): the first draft sent a hello without the required `contract` field; the gateway correctly treated that as malformed (4401, uncounted), which made checks 5 and 8 fail and check 4 pass for the wrong reason. The committed script sends `contract: 1`.

## B. Manual browser QA (docs/qa-test-plan.md, "Manual QA: Auth and secure transport (Phase 8)")

PENDING-HUMAN: the browser steps cannot be run by an automated executor (they need a real browser, its Network tab and session storage). "Smoke" means the server side of the step is covered by section A.

| # | Step | Status |
|---|------|--------|
| 1 | Start a token gateway on a free port, open the UI configured for it: the dialog appears with no roster | PENDING-HUMAN |
| 2 | Wrong token: dialog reappears with the Authentication failed hint after exactly one attempt (one WebSocket in the Network tab) | server side PASS (smoke 4); browser side PENDING-HUMAN |
| 3 | Right token: Connected, roster arrives | PENDING-HUMAN |
| 4 | WebSocket URL has no query string and no token in any request URL; only storage entry is `agent-manager.token` in session storage | PENDING-HUMAN |
| 5 | Five wrong tokens then a sixth: UI reports a connection problem, gateway closes 4429, a correct token works after the lock | server side PASS (smoke 8); browser side PENDING-HUMAN |
| 6 | Reload keeps the session without the dialog; close and reopen the tab shows the dialog | PENDING-HUMAN |
| 7 | curl `/api/agents` without and with the Bearer header: 401 and 200 | PASS (smoke 7) |
| 8 | Header Log out: roster, panes and terminal output disappear, session storage empty, dialog opens | PENDING-HUMAN |
| 9 | Palette Log out present only while signed in | PENDING-HUMAN |
| 10 | FE configured with an `http://` non-loopback backend: banner shows the refusal, no WebSocket in the Network tab | PENDING-HUMAN |
| 11 | Gateway with a non-loopback HOST and no token refuses, naming AGENT_MANAGER_TOKEN | PASS (smoke 1) |
| 12 | Optional, with a TLS proxy per docs/RUNNING.md: wss connects, a client cannot influence the throttle with its own X-Forwarded-For | PENDING-HUMAN (optional) |

Per-step results from a human run: not yet recorded.

## C. Gate results

| # | Command | Exit | Result |
|---|---------|------|--------|
| 1 | `npm run build:protocol && npm test` | 0 | 113 files passed, 2281 tests passed, 2 todo (Phase 21 hand-offs); includes the server suite |
| 2 | `npx tsc --noEmit` (root) | 0 | clean |
| 3 | `npx tsc --noEmit` (server) | 0 | clean |
| 4 | `npm run build` | 0 | clean |
| 5 | `npm --prefix server test` | 0 | 33 files, 845 tests passed |
| 6 | `npm --prefix server run build` | 0 | clean |
| 7 | `npm run build:protocol` | 0 | clean |
| 8 | `npm run contract:check` | 0 | OK relative to HEAD (no surface change) |
| 9 | `node server/scripts/smoke-auth.mjs` | 0 | 9 passed, 0 failed |
| 10 | `node .planning/tools/check-wave-collisions.mjs --pending` | 0 | wave 13: 08-05 alone, disjoint ownership |
| 11 | stale-sentence gate (`grep -rn` for the six baseline patterns over docs, server/README.md, README.md) | prints nothing | 0 matching lines (baseline 6 in 3 files) |

The known `hardening.test.ts` "never terminates a responsive client" flake did not occur.

No file under `src/`, `server/src`, `packages/`, root `package.json`, lockfiles or `.github/` changed in this plan.
