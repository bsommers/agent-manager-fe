# @agent-manager/protocol

The single, executable definition of the wire contract between the Agent Manager front end and the gateway:
message and HTTP body types, runtime validators (field-spec tables), error codes, capabilities and limits.
The prose contract is `docs/superpowers/specs/2026-11-07-fe-be-contract.md`; section 13 explains why the
schema lives in this package.

## How it is consumed

- The front end imports `@agent-manager/protocol`, resolved by the alias in `vite.config.ts` and the `paths`
  entry in the root `tsconfig.json` (both point at `packages/protocol/src/index.ts`).
- The server resolves the built package (`npm run build:protocol` emits `dist/index.js` and `dist/index.d.ts`).
- External adapters in other languages read `fixtures/*.json` (`client.json`, `server.json`, `http.json`,
  `invalid.json`), the language-neutral conformance corpus.

Dev tooling (TypeScript, vitest, vite-node) comes from the repository root install; the package has no
dependencies of its own.

## Operations catalog

`src/operations.ts` holds `OPERATIONS`, one entry per thing a client can ask the gateway to do (twelve today,
contract spec section 4.3). Each entry has its parameters, requirements, `readOnly` and `destructive` flags
and one binding per surface: WebSocket message, HTTP route, MCP tool and command palette id (or a `none` with
a reason). The client validator rows (`CLIENT_TABLE`), the HTTP route list, the MCP tool list and the palette
identities derive from it. Only `agent.kill` is destructive, and a destructive operation never has a palette
binding. The FE builds its three operation palette commands from it (`src/keyboard/commands.ts`); titles and
other UI strings stay in the FE.

## Adding or changing a message

1. An operation message is added or changed in its `OPERATIONS` entry in `src/operations.ts` (its `CLIENT_TABLE`
   row derives from it), and the operations table in contract spec section 4.3 gets the matching row. Any other
   message gets its type in `src/messages.ts` and a row in `SERVER_TABLE` in `src/validate.ts` (or `HTTP_TABLE`
   in `src/http.ts`). The `satisfies` clauses make a missing row a compile error.
2. Add valid and invalid cases to `fixtures/*.json`.
3. Run `npm run contract:update` and the schema generator (see Commands), review the diffs of
   `contract.snapshot.json` and `contract.schema.json`, and commit them with the change.
4. Update the contract spec so the prose and the tables stay in step.

## Breaking and additive changes

`contract.snapshot.json` is generated from the tables by `describeSurface()`. `npm run contract:check`
compares it with the snapshot at a base git ref.

Additive (no `CONTRACT_VERSION` bump): a new message type or HTTP kind (even with required fields), a new
optional field, a new enum value, a raised maximum or lowered minimum, a removed rule, a new error code or
capability, a raised limit.

Breaking (requires raising `CONTRACT_VERSION` in `src/limits.ts`): removing a message type, HTTP kind, field,
enum value, error code or capability; changing a field kind; making an optional field required; adding a
required field to an existing type; lowering a maximum or raising a minimum; adding a rule; lowering a limit
or the contract number.

## Commands

Run from the repository root:

| Command | Purpose |
|---|---|
| `npm run build:protocol` | Build `dist/` (JS and declarations) |
| `npx vitest run packages/protocol` | Package tests (validators, fixtures, surface, contract check, CI policy) |
| `npm run contract:check -- --base <ref>` | Fail if the snapshot is stale or the surface breaks relative to `<ref>` (default `HEAD`) |
| `npm run contract:update` | Regenerate `contract.snapshot.json` |
| `npx vite-node packages/protocol/scripts/generate-schema.ts` | Regenerate `contract.schema.json` (see `SCHEMA.md`) |

`SCHEMA.md` explains the generated JSON Schema in `contract.schema.json`; `contract:check` also fails when that
file is stale.

`contract:check` exit codes: 0 ok, 1 stale snapshot or breaking change without a version bump, 2 usage error
(unsafe ref such as `--evil`, unknown argument, ref that does not resolve).

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `master` with read-only `contents`
permission and no secrets. It builds the package, runs the root and server suites and builds, and on pull
requests runs the contract check against `origin/$BASE_REF`. The base branch name reaches the shell only
through an environment variable. `packages/protocol/src/__tests__/ci-workflow.test.ts` enforces these
properties.
