# Coding Conventions

**Analysis Date:** 2026-11-07

## Naming Patterns

**Files:**
- React components: PascalCase `.tsx` (`src/components/layout/BroadcastBar.tsx`, `src/components/agent/AgentPane.tsx`).
- Services/stores/types: camelCase `.ts` (`src/services/agentSocket.ts`, `src/store/logBufferStore.ts`, `src/types/agent.ts`).
- Server services: PascalCase classes (`server/src/services/SessionManager.ts`, `TmuxDriver.ts`); utils camelCase (`server/src/utils/sshKeyLoader.ts`).
- Tests live in sibling `__tests__/` dirs, named `<Subject>.test.ts(x)`.

**Functions/variables:** camelCase; constants UPPER_SNAKE (`INITIAL_AGENTS`, `CONFIG.WS_PATH`).
**Types:** PascalCase interfaces (`AgentStoreState`, `Agent`, `WSMessageClient`).
**Hooks/stores:** `useXxxStore` zustand hooks (`useAgentStore`).

## Code Style

**Formatting:** No Prettier/Biome config; 2-space indent, single quotes, semicolons, trailing commas (match existing files).
**Linting:** No ESLint config detected. Type safety enforced only by `tsc` (`strict: true`, `noImplicitReturns` in `tsconfig.json`; `noUnusedLocals/Parameters` are off).
**Styling:** Tailwind (`tailwind.config.js`, `src/styles/globals.css`).

## Import Organization

1. External packages (`react`, `zustand`, `lucide-react`)
2. Relative project imports (`../services/agentSocket`)

Alias `@/*` -> `src/*` is configured (`vite.config.ts`, `tsconfig.json`) but source mostly uses relative imports. Server (ESM) imports require `.js` suffix on relative paths (`./config.js`).

## Error Handling

- Parse/JSON failures are caught and logged with `console.error` (`server/src/index.ts`).
- Frontend socket failures degrade to mock mode with `console.warn` (`src/services/agentSocket.ts`).
- Catch clauses use `err: any` (`src/components/layout/GlobalSearchModal.tsx`); prefer `unknown`.

## Logging

`console.*` directly; no logger. Server banner logs are suppressed when `NODE_ENV === 'test'`.

## Comments

Short explanatory line comments above logical blocks; no JSDoc.

## Function Design

Zustand actions defined inline in `create(...)` (`src/store/agentStore.ts`). Components are function components with hooks, props typed via interfaces.

## Module Design

Named exports (no default except `App`). No barrel files. Stores also export a Proxy compatibility object (`agentStore`, `logBufferStore`) alongside the hook; new code should use the `use*Store` hooks.

---

*Convention analysis: 2026-11-07*
