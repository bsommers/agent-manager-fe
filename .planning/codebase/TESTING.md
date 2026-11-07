# Testing Patterns

**Analysis Date:** 2026-11-07

## Test Framework

**Runner:**
- Vitest ^1.6 (frontend config in `vite.config.ts`: globals, jsdom, setup `src/setupTests.ts`)
- Server has its own Vitest setup (`server/package.json`, `"test": "vitest run"`)

**Assertion Library:** Vitest `expect` + `@testing-library/jest-dom`; `@testing-library/react` and `user-event` for components.

**Run Commands:**
```bash
npm test                       # frontend, vitest run
npx vitest run --coverage      # coverage (@vitest/coverage-v8; output in coverage/)
cd server && npm test          # backend
```

## Test File Organization

- Separate `__tests__/` directories beside the code: `src/components/__tests__/`, `src/components/layout/__tests__/`, `src/components/agent/__tests__/`, `src/store/__tests__/`, `src/services/__tests__/`, `server/src/**/__tests__/`.
- `src/App.test.tsx` is co-located at the root.

## Test Structure

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
describe('Header Component', () => {
  it('renders title and system metric counters', () => {
    render(<Header />);
    expect(screen.getByText(/Active:/i)).toBeInTheDocument();
  });
});
```

## Mocking

- `src/setupTests.ts` globally stubs `ResizeObserver`, `window.matchMedia`, and `HTMLCanvasElement.getContext` for xterm in jsdom.
- `AgentSocketService` forces mock mode when `NODE_ENV === 'test'` (`src/services/agentSocket.ts`), and `MockStreamGenerator` supplies deterministic data.
- Mock node-pty/ssh2/child_process in server tests (`server/src/services/__tests__/`).

**Do not mock:** zustand stores; use real stores and reset state in tests.

## Fixtures

Inline per-test data; store seed data `INITIAL_AGENTS` in `src/store/agentStore.ts`. No shared fixtures dir.

## Coverage

No threshold enforced. `coverage/` and `dist/` are gitignored.

## Test Types

- Unit: stores, services, protocol (`src/store/__tests__`, `server/src/protocol/__tests__`).
- Component: RTL render tests per component.
- Integration: `server/__tests__/index.test.ts` (bootstraps HTTP/WS).
- E2E: not used. No CI config detected.

---

*Testing analysis: 2026-11-07*
