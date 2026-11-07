# Backend Integration Plan: Agent Manager FE vs. mads / mad / climah / cvm

**Date:** 2026-11-07
**Status:** Proposed
**Inputs:** FE `src/services/wsProtocol.ts`, `agentSocket.ts`, `store/*`, `server/src/*`; specs `2026-08-15-agent-manager-backend-{design,plan}`; READMEs/SPECs/docs of the four candidates (read-only).

---

## 1. What the FE needs (derived from code)

| Need | Where | Detail |
|---|---|---|
| Single WS `ws://host:8088/ws` (`VITE_WS_URL`) | `agentSocket.ts` | JSON frames; on error/close it silently falls back to the mock driver |
| Client->server | `wsProtocol.ts` | `agent:input`, `agent:resize`, `agent:create {name,mode:'tmux'\|'ssh',targetHost,initialCmd?}`, `agent:kill`, `agent:broadcast {targetAgentIds[],data}` |
| Server->client | `wsProtocol.ts` | `agent:output {agentId,data}` (raw xterm bytes incl. ANSI), `agent:status_change {status: idle\|running\|thinking\|error\|disconnected}`, `agent:init_list {agents[]}` |
| Terminal semantics | xterm.js panes | Needs an interactive **PTY byte stream** with resize and input; this is the core FE assumption |
| Log search | `logBufferStore` | Client-side ring buffer (10k lines/agent, ANSI stripped) fed from `agent:output`; search is local, no server API today |
| Toasts | `NotificationToastManager` | Driven by `status_change` transitions |
| Broadcast | `BroadcastBar` | Today a client-side fan-out message; server must accept `agent:broadcast` |
| Gaps in current wire | - | No auth, no history replay on (re)connect, no pagination for logs, no `agent:error`, FE default port 8088 vs spec port 8080 (inconsistency to fix) |

Existing `server/` (~500 LOC, Node, node-pty + ssh2 + tmux discovery) already implements this contract for tmux/ssh.

## 2. Candidate evaluation

### 2.1 ~/src/meso/mads (Rust workspace; `mads-core`, `mads-cli`)
- **What:** Embedded SQLite (WAL) multi-agent *state store*: claims/leases with fencing tokens, versioned artifacts, event log, handoffs, checkpoints/rollback, recall/context assembly. Contract `mads.contract/1`. Branch `gsd/phase-01...` in progress; no git remote (no `bsommers/mads` on GitHub), local only.
- **API surface:** CLI (`mads <verb> --json`, `mads tool <verb>` stdin JSON) returning `{ok,data,contract}` / `{ok:false,error{code,retryable}}`. Agent verbs: `get_agent_context, claim_task, heartbeat, release_task, put_artifact, get_artifact, transition_status, write_handoff, take_handoff`; operator verbs `run.open, run.status, event.append, event.tail, list, checkpoint.*, doctor, stats`. Rust crate for linking. **No HTTP/WS/gRPC/MCP server.**
- **Fit:** Not an agent runner. No terminals, no PTY, no streaming. Useful as a *shared state/event store* (agent roster, status, durable event history) behind the gateway.
- **Gaps:** no push (poll `event.tail`), no output capture, no network API. **Effort:** Low-Med as a *state adapter* (spawn CLI, parse JSON); Very High as a primary.

### 2.2 ~/src/inter/mad (Python 3.11 stdlib)
- **What:** Local dispatcher/router: scores a task, picks `claude` (haiku/sonnet/opus) vs `agy`, fetches bounded context, handles 80%-quota handoff (`.opengsd_handoff.md`). Has a `mads` state backend (`mads_client.py`, subprocess). Remote `origin` bsommers/mad == local HEAD (5712ed4, 2026-11-05/06): not newer.
- **API surface:** CLI only (`mad route|run|fetch|check|handoff|init`, exit code 10 = handoff needed; JSON on `route`). No server, no streaming API.
- **Fit:** Peripheral. Offers a routing decision (`mad route --json`) the FE could show when creating an agent, and a handoff action. No lifecycle, no output stream.
- **Gaps:** everything runtime. **Effort:** Low for a "route/handoff" side-capability; not a backend.

### 2.3 ~/src/tests/climah (Rust single binary; CLI-driven multi-agent build harness)
- **What:** Pipeline orchestrator (SPEC->PLAN->BUILD waves->TEST->REVIEW) with git-worktree isolation, FinOps budget/hard-stop, approval gates, agent descriptors (claude/agy/cursor/codex). Local checkout is on `feat/structured-usage-parse` at cc55f4c (2026-11-05); **GitHub `bsommers/climah` HEAD is newer** (4752df7, 2026-11-07 19:15Z, merge of PR #4 structured-usage-parse). Pull/rebase before adapting.
- **API surface:** CLI (`run, status, dashboard, events tail --follow --json, budget, worktree, route, descriptor`). Structured, versioned `events.jsonl` (`EventEnvelope{schema_version,event_id,run_id,timestamp,kind,level,agent,wave_id,payload}`; kinds: run_*, level_*, agent_invoked, agent_chunk_received, agent_output_received, usage_reported, budget_*, wave_*, merge_*, gate_awaiting_approval/approved/denied). SPEC 10 explicitly leaves a socket/SSE live transport as an open question (16.11). No server today.
- **Fit:** Best *semantic* match for "agents with statuses and output" from a pipeline: `agent_chunk_received` -> `agent:output` (text, not PTY), `agent_invoked`/`run_*`/`gate_*`/`budget_hard_stop` -> `status_change` (+ toasts). Read-only observation is easy (tail the file). Input/resize/kill do not map (headless agents, no stdin); gates need an approve/deny action (`GateAwaitingApproval` -> needs a CLI command to answer; verify it exists).
- **Gaps:** no PTY/input; no daemon; no agent-level lifecycle (runs are the unit); mapping run/agent/wave to FE `Agent` is a design choice. **Effort:** Medium (events-file tailer adapter ~300-500 LOC; control actions via CLI).

### 2.4 ~/src/ai/projects/cvm (Bash + Python stdlib; sandbox VM/container runner)
- **What:** Runs autonomous coding agents (Claude, agy, Codex, Cursor) in isolated sandboxes across 13 backends; named persistent VMs, snapshots/branches, mesh networking, budget caps. v1.2.0, Apache-2.0. Remote bsommers/cvm HEAD == local (ce82725, 2026-11-06): not newer.
- **API surface (richest of the four):** `cvmd` HTTP REST on :9800 with Bearer token + RBAC (admin/operator/viewer), tenants, quotas, audit. Endpoints: `GET /api/v1/health|quotas|autoscale|tenants|audit|vms|vms/{n}|tasks/{id}`, `POST /api/v1/vms/spinup`, `/vms/{n}/start|stop|snapshot|restore`, `DELETE /vms/{n}`, `POST /api/v1/tasks/run {task,vm,queue}` -> `{task_id,status}`, `GET /api/v1/tasks/{id}/events` (**SSE**: `event: log`, heartbeat, `event: done` with exit code), `DELETE /api/v1/tasks/{id}`. Also MCP server (`cvm serve-mcp`, stdio JSON-RPC) and a web console.
- **Fit:** Best *remote lifecycle + log streaming* match. VM = FE agent (spinup/start/stop/delete/status), task = a prompt dispatched to it, SSE `log` = `agent:output`, `done` = `status_change`. Isolation story is a strong differentiator (autonomous agents with zero host risk).
- **Gaps:** task-oriented, not interactive: no stdin, no resize, no PTY (log lines, not a TTY); no WS; no push of VM status (poll `GET /vms`); no log history/search endpoint; browser cannot send Bearer to EventSource (needs a proxy, i.e. the gateway). **Effort:** Medium (REST+SSE client adapter ~400 LOC; poller for status).

## 3. Comparison matrix

| Criterion | FE `server/` (tmux/ssh) | mads | mad | climah | cvm |
|---|---|---|---|---|---|
| Role | PTY gateway | state store | task router | pipeline harness | sandbox fleet |
| Language | TS/Node | Rust | Python | Rust | Bash+Py |
| Network API | WS (FE contract) | none (CLI/crate) | none (CLI) | none (CLI + events.jsonl) | REST + SSE + MCP |
| Interactive PTY / stdin / resize | Yes | No | No | No | No |
| Agent lifecycle (create/kill) | Yes | roster rows only | No | per-run | Yes (VMs, tasks) |
| Live output stream | raw bytes | event.tail poll | No | events.jsonl tail | SSE log lines |
| Status model | 5 states | run/claim status | exit codes | rich events | VM state + task exit |
| Output history/search | no (FE ring buffer) | events/recall | .global_dev_log | events.jsonl | no |
| Auth | none | none | none | none | Bearer + RBAC |
| Maturity / remote freshness | WIP | local only, in-phase | == origin | origin newer (+PR #4) | == origin, v1.2.0 |
| FE contract fit | Native | Low | Very low | Medium (read-mostly) | Medium-High (remote) |
| Adapter effort | 0 | L-M | L | M | M |

## 4. Recommendation

1. **Primary backend = the existing FE gateway (`server/`, tmux + ssh PTY drivers), hardened.** It is the only component that satisfies the xterm/PTY contract (input, resize, raw bytes). None of the four candidates can replace it; they are *orchestration back-ends, not terminal back-ends*.
2. **Of the four candidates, `cvm` (cvmd) is the primary integration** (only one with a network API, auth, lifecycle, and live stream), delivered as a `CvmAdapter` behind the gateway.
3. **`climah` second** as a read-mostly `ClimahAdapter` (events.jsonl tail; pipeline progress, budget, gate toasts), after syncing to origin HEAD 4752df7.
4. **`mads` as an optional shared state/event store** (`MadsStateStore`) for durable roster/status/event history and cross-restart rehydrate (replaces tmux-discovery-only recovery); lowest priority, since no push API.
5. **`mad`: do not adapt as backend.** Expose `mad route` as an optional "suggest agent/model" helper on the create dialog (Phase 5).

All plug in as adapters behind **one BE contract** (Section 5) terminated by the gateway, so the FE never changes per backend. The FE only sees `Agent.mode` extended and an optional `capabilities` list.

## 5. FE <-> BE contract (v1, additive to current `wsProtocol.ts`)

Transport: WebSocket `/ws` (unchanged) + small HTTP admin API on the same port. Auth: `?token=` or `Sec-WebSocket-Protocol` bearer; HTTP `Authorization: Bearer`. Contract version in `hello`.

### 5.1 WS messages
Existing (unchanged): client `agent:input|resize|create|kill|broadcast`; server `agent:output|status_change|init_list`.

Additions (all optional-for-FE; unknown types ignored by FE):

```ts
// extend
type AgentMode = 'tmux' | 'ssh' | 'cvm' | 'climah';           // adapter id
interface Agent { ...existing; capabilities?: Capability[]; backend?: string; meta?: Record<string,unknown> }
type Capability = 'input' | 'resize' | 'kill' | 'history' | 'approve' | 'snapshot';

type WSMessageClient += 
  | { type: 'hello'; contract: 1; token?: string; resumeFrom?: Record<agentId, seq> }
  | { type: 'agent:approve'; agentId: string; gateId: string; decision: 'approve'|'deny' }
  | { type: 'agent:history'; agentId: string; beforeSeq?: number; limit?: number };

type WSMessageServer += 
  | { type: 'hello_ack'; contract: 1; backends: {id,capabilities}[] }
  | { type: 'agent:added'; agent: Agent } | { type: 'agent:removed'; agentId: string }
  | { type: 'agent:error'; agentId?: string; code: ErrorCode; message: string; retryable: boolean }
  | { type: 'agent:history_chunk'; agentId: string; fromSeq: number; data: string; hasMore: boolean }
  | { type: 'agent:progress'; agentId: string; stage?: string; budget?: {spent:number;cap:number} }
  | { type: 'agent:gate'; agentId: string; gateId: string; prompt: string };
// agent:output gains optional `seq: number` (monotonic per agent) for replay/dedupe.
type ErrorCode = 'USAGE'|'NOT_FOUND'|'CONFLICT'|'FORBIDDEN'|'UNSUPPORTED'|'BACKEND_DOWN'|'INTERNAL'; // aligned with mads.contract/1 codes
```

Status mapping rule: adapters must map native state to the 5 FE statuses (`idle|running|thinking|error|disconnected`); native detail goes in `meta`.

### 5.2 HTTP (admin/search, same server)
- `GET /api/health` -> `{ok, contract, backends:[{id,up}]}`
- `GET /api/agents` -> `Agent[]`
- `POST /api/agents` (same payload as `agent:create` + `backend`), `DELETE /api/agents/:id`
- `GET /api/agents/:id/logs?beforeSeq&limit` -> `{lines:[{seq,ts,text}],hasMore}` (ANSI preserved; FE strips)
- `GET /api/search?q=&regex=&agentId=&caseSensitive=&limit=` -> `{results:[{agentId,seq,ts,text,matchIndex}]}` (server-side search over persisted log; FE keeps local search as fallback)
- Errors: `{ok:false,error:{code,message,retryable,detail}}` (mirrors mads wire envelope).

### 5.3 Adapter -> contract mapping
| FE concept | tmux/ssh (native) | cvm | climah | mads (state) |
|---|---|---|---|---|
| create | spawn PTY | `POST /vms/spinup` (+`/tasks/run` with `initialCmd` as task) | `climah run <prompt>` subprocess; agent = run/agent pair | `run.open`, roster row |
| output | pty bytes | SSE `log` -> `\r\n` normalized | `agent_chunk_received.payload` | n/a (events only) |
| status | pty alive/idle detect | VM state + task running/done(exit) | `agent_invoked`->running, `run_completed`->idle, `run_failed`/`budget_hard_stop`->error, `gate_awaiting_approval`->thinking + `agent:gate` | `transition_status` |
| input / resize | yes | unsupported (capabilities omit) | unsupported | n/a |
| kill | kill pty | `DELETE /tasks/:id` or `/vms/:n` | signal process | release_task |
| broadcast | fan-out to `input` | fan-out to new `tasks/run` (capability-checked) | unsupported | n/a |

## 6. Adapter architecture

```
FE (xterm, zustand)  --WS /ws + HTTP /api-->  Gateway (server/, Node)
                                              |- SessionManager (registry, routing, seq/ring buffer, auth)
                                              |- LogStore (append-only per agent; SQLite or jsonl; search)
                                              |- BackendAdapter interface:
                                              |     id, capabilities, list(), create(spec), kill(id),
                                              |     input?(id,data), resize?(id,c,r), approve?(id,gate,dec),
                                              |     events: AsyncIterable<AdapterEvent{output|status|added|removed|gate|progress|error}>
                                              |- TmuxAdapter, SshAdapter    (existing drivers, refactored)
                                              |- CvmAdapter    -> cvmd REST+SSE (Bearer, poll /vms every 5s, SSE per task)
                                              |- ClimahAdapter -> spawn `climah`, tail .climah/runs/*/events.jsonl
                                              `- MadsStateStore (optional) -> spawn `mads ... --json` (never shell=true); persists roster/events
```

Principles: adapters declare `capabilities`; gateway rejects unsupported ops with `agent:error UNSUPPORTED` (FE greys controls); backend failures isolate per adapter (`BACKEND_DOWN` -> agents `disconnected`, auto-retry with backoff); credentials (cvmd token) only server-side, never sent to the browser; subprocess spawn uses argv arrays only; every adapter has a recorded-fixture contract test and a fake backend for offline dev (parity with FE mock mode).

## 7. Phased integration steps

**Phase 0 - Baseline (1-2d).** Reconcile port (8088 vs 8080), run server+FE e2e against tmux, fix mock-fallback masking (surface a visible "mock mode" banner). *Accept:* FE connects to real tmux session, typing/resize work, `npm test` green in both packages.

**Phase 1 - Contract + gateway core (3-4d).** Add `hello/hello_ack`, `seq` on output, `agent:error`, `agent:added/removed`, `BackendAdapter` interface; refactor tmux/ssh into adapters; ring buffer + `LogStore`; `GET /api/agents|health|agents/:id/logs`. Sync `wsProtocol.ts` (single source in `server/`, FE re-exports - already the case). *Accept:* reconnect with `resumeFrom` replays missed output without duplicates; contract unit tests (vitest) cover each message; FE unchanged behavior with only tmux/ssh.

**Phase 2 - CvmAdapter (4-5d).** Start `cvm daemon`, implement spinup/start/stop/delete/list, `tasks/run` + SSE parse (`log`, `done`, heartbeat), status poller, token from env/`~/.config/cvm/daemon_token`. FE: create dialog gets mode `cvm`, controls respect `capabilities`. *Accept:* creating a cvm agent from UI spins a VM, task prompt streams into the xterm pane, `done` exit 0 -> idle, non-zero -> error toast; kill terminates task; cvmd down -> agents `disconnected` then recover; 429 quota shown as `agent:error`; integration test against a fake cvmd (recorded SSE) plus manual run on docker backend.

**Phase 3 - Search + broadcast server-side (2-3d).** `/api/search` over `LogStore`; FE `GlobalSearchModal` falls back to local when server unreachable; broadcast routed per adapter with capability filtering and per-target result. *Accept:* search across 3 agents (incl. regex, case flag) matches FE local results on a shared fixture; broadcast to mixed tmux+cvm targets reports skipped/unsupported targets; DestructiveSafetyModal still gates.

**Phase 4 - ClimahAdapter (4-5d).** First `git pull` climah to origin 4752df7 and re-verify event schema_version/kinds. Tail events, map kinds->status/output/gate/progress, `agent:approve` -> climah gate action (confirm CLI support or add `climah gate approve` upstream), budget progress in header. *Accept:* a `climah run` started from UI shows waves as agents, gate toast appears and approve/deny resumes the run, `budget_hard_stop` -> error toast, replay of an existing run dir populates history, tolerant of unknown event kinds and schema_version bumps.

**Phase 5 - Optional: mads state + mad route (3d).** `MadsStateStore` persisting roster/status/events and rehydrating on restart (beyond tmux discovery); `mad route --json` suggestion in create dialog. *Accept:* kill -9 gateway, restart, roster and last status restored from mads; mads CLI contract version asserted at startup (`mads.contract/1`); route suggestion non-blocking and off by default.

**Phase 6 - Hardening (2d).** Auth required for non-loopback bind, origin check on WS, rate limit, input size limits, structured logs, docs (`server/README.md`, contract doc), CI with fake backends.

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Candidates are non-interactive; users expect a terminal | UX mismatch | Capability flags; read-only panes labelled; keep tmux/ssh primary; optional interactive follow-up via `cvm` shell later |
| ANSI/line semantics differ (SSE lines, JSON text vs raw PTY) | broken rendering/search | Adapters normalize to `\r\n`, mark `meta.format`; FE ANSI stripping already in LogBuffer |
| Unauthenticated gateway exposes shells (tmux/ssh) | Critical security | Phase 6 auth, loopback default, no cvmd token to browser, argv-only subprocess |
| climah local checkout behind origin; schema may change | adapter breakage | Pull first, pin `schema_version`, ignore unknown kinds, fixture tests |
| mads has no remote/server and is mid-phase; contract may bump (/2) | churn | Optional phase, assert contract at startup, keep behind interface |
| cvmd stdlib `http.server` scale/threading limits; SSE auth impossible from browser EventSource | perf/security | Gateway proxies SSE server-side; cap concurrent streams; poll interval tunable |
| Log persistence growth and secret leakage in logs | disk/privacy | Per-agent size cap + rotation; reuse redaction approach (mads `redact.toml`, climah `events/redact.rs`) |
| FE silent mock fallback hides real failures | false confidence | Visible mode banner; env flag to disable fallback in prod |
| Status inference for raw PTY (idle vs thinking) is heuristic | flaky toasts | Debounce transitions; adapters with native state (cvm/climah) preferred |
| Scope creep into building a cluster manager | schedule | Gateway stays thin; delegate scheduling/quota to cvmd, state to mads |

## 9. Open questions
1. Does climah expose an approve/deny command for gates, or must one be added upstream?
2. Should `Agent` for climah be per-run, per-level, or per-wave agent? (Proposed: per agent name within a run.)
3. Does cvm need an interactive attach endpoint (WS PTY) to reach parity? Out of scope here; track as upstream feature.
4. Where does mads live (no remote)? Needs a repo/remote before being a hard dependency.
