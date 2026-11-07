# Technology Stack

**Analysis Date:** 2026-11-07

## Languages
**Primary:**
- TypeScript ^5.4.5 (strict) - frontend `src/`, backend `server/src/`
**Secondary:**
- Bash - launch scripts `scripts/start-*.sh`; CSS (Tailwind) `src/styles/`

## Runtime
- Node.js (types ^20.11); ESM (`"type": "module"` in both package.json files)
- npm; lockfiles `package-lock.json` and `server/package-lock.json` present
- Browser: DOM + WebSocket + xterm.js

## Frameworks
**Core:**
- React ^18.3.1 + react-dom - UI
- zustand ^5.0.15 - state (`src/store/`)
- @xterm/xterm ^5.5.0, @xterm/addon-fit, @xterm/addon-web-links - terminal rendering
- lucide-react ^0.344.0 - icons
- Express ^4.19.2 + ws ^8.17.1 - backend HTTP/WebSocket (`server/src/index.ts`)
**Testing:** vitest ^1.6 (jsdom ^29, @testing-library/react/user-event/jest-dom, @vitest/coverage-v8)
**Build/Dev:** Vite ^5.3 + @vitejs/plugin-react (`vite.config.ts`, port 3000), Tailwind ^3.4 + PostCSS + autoprefixer, tsx (backend dev watch)

## Key Dependencies
- node-pty ^1.0.0 - attaches to local tmux via PTY (`server/src/services/TmuxDriver.ts`)
- ssh2 ^1.15.1 - remote shells (`server/src/services/SshDriver.ts`)

## Configuration
- Backend: `server/src/config.ts` (env PORT default 8088, SHELL, SSH_AUTH_SOCK; WS path `/ws`)
- Frontend: `VITE_WS_URL` (default `ws://localhost:8088/ws`) in `src/services/agentSocket.ts`
- Build: `tsconfig.json` (alias `@/*` -> `src/*`), `server/tsconfig.json`, `tailwind.config.js`, `postcss.config.js`
- `npm run build` = `tsc && vite build`; backend `npm run build` emits `server/dist/` (committed in tree)

## Platform Requirements
- Dev: Node, tmux installed, optional SSH keys/agent; `npm run start:all` (`scripts/start-all.sh`)
- Production: Not defined; two processes (static frontend `dist/`, Node server)

---
*Stack analysis: 2026-11-07*
