# Codebase Structure

**Analysis Date:** 2026-11-07

## Directory Layout
```
agent-manager-fe/
├── src/
│   ├── main.tsx, App.tsx
│   ├── components/{layout,agent}/   # UI; tests in __tests__/
│   ├── store/                       # zustand stores
│   ├── services/                    # agentSocket, mockStreamGenerator, wsProtocol re-export
│   ├── types/agent.ts               # type re-exports + LayoutMode
│   └── styles/                      # globals.css, xterm-theme.css
├── server/
│   ├── src/{index.ts,config.ts,protocol,services,utils}
│   ├── dist/                        # compiled output (generated)
│   └── __tests__/index.test.ts
├── scripts/                         # start-backend/frontend/all.sh
├── docs/  .planning/  coverage/  dist/
└── vite.config.ts tailwind.config.js tsconfig.json index.html
```

## Key File Locations
- Entry: `src/main.tsx`, `server/src/index.ts`
- Config: `vite.config.ts`, `tsconfig.json`, `server/src/config.ts`
- Protocol: `server/src/protocol/wsProtocol.ts`
- Core logic: `src/store/agentStore.ts`, `server/src/services/SessionManager.ts`
- Tests: `src/**/__tests__/*.test.ts(x)`, `src/App.test.tsx`, `server/src/**/__tests__/`, `server/__tests__/`; setup `src/setupTests.ts`

## Naming Conventions
- Components: PascalCase `.tsx` (`FloatingPane.tsx`); stores/services camelCase (`agentStore.ts`); server classes PascalCase (`TmuxDriver.ts`); tests `<Name>.test.ts(x)` in sibling `__tests__/`.
- Server imports use `.js` extensions (ESM).

## Where to Add New Code
- New UI component: `src/components/layout/` (workspace chrome) or `src/components/agent/` (per-agent); test in sibling `__tests__/`.
- New state: `src/store/<name>Store.ts` with test in `src/store/__tests__/`.
- New WS message: add to `server/src/protocol/wsProtocol.ts`, handle in `SessionManager.handleClientMessage`, mock in `src/services/mockStreamGenerator.ts`/`agentSocket.ts`.
- New backend transport: class with `write/resize/close` in `server/src/services/`, wire in `SessionManager`.
- Helpers: `server/src/utils/` (backend); frontend has no utils dir (create `src/utils/`).

## Special Directories
- `server/dist/`, `dist/`, `coverage/`: generated build/test output.
- `.planning/`: GSD planning docs. `.superpowers/`: tooling state.

---
*Structure analysis: 2026-11-07*
