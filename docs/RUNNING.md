# AI Agent Manager Running & Setup Guide

This guide provides step-by-step instructions for installing, configuring, running, and troubleshooting the **AI Agent Manager** full-stack application.

---

## 1. System Requirements

| Prerequisite | Recommended Version | Details |
| :--- | :--- | :--- |
| **Operating System** | Linux / macOS | Recommended for native `tmux` & PTY support |
| **Node.js** | v18.0.0 or higher | Required for ESM module resolution & async PTY |
| **npm** | v9.0.0 or higher | Node package manager |
| **tmux** | v3.0 or higher *(optional)* | Required for local `tmux` session auto-discovery |
| **SSH Agent** | Active SSH Agent *(optional)* | For key-based authentication to remote SSH agents |

---

## 2. Installation & Setup

Clone the repository and install dependencies:

```bash
# 1. Clone repository
git clone https://github.com/bsommers/agent-manager-fe.git
cd agent-manager-fe

# 2. Install Root Frontend Dependencies
npm install

# 3. Install Backend Server Dependencies
cd server && npm install && cd ..
```

---

## 3. Running the Application

### Method A: Start Both Frontend & Backend Concurrently (Recommended)

Run the master startup script:

```bash
npm run start:all
# OR
./scripts/start-all.sh
```

**What this does:**
1. Launches the Node.js WebSocket backend on `http://localhost:8088` (`ws://localhost:8088/ws`).
2. Waits 2 seconds for backend initialization.
3. Launches the Vite React frontend dev server on `http://localhost:3000`.
4. Traps `Ctrl+C` / `SIGINT` to gracefully shut down both servers simultaneously.

---

### Method B: Start Backend and Frontend Separately

If you prefer to run services in dedicated terminal windows:

#### Step 1: Start Backend Server
```bash
npm run start:backend
# OR
./scripts/start-backend.sh
```

#### Step 2: Start Frontend UI
```bash
npm run start:frontend
# OR
./scripts/start-frontend.sh
```

---

## 4. Environment Variables Configuration

Both backend and frontend can be customized via environment variables:

### Backend Environment Variables (`server/`)

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `8088` | HTTP & WebSocket server port |
| `HOST` | `127.0.0.1` | Interface the gateway binds to. A non-loopback value is refused until token authentication ships (Phase 8) |
| `ALLOWED_ORIGINS` | Vite dev and preview origins on `localhost` and `127.0.0.1` | Comma-separated browser origins allowed to open the WebSocket; other origins are rejected with HTTP 403 |
| `SHELL` | `/bin/bash` | Default shell binary used by PTY driver |
| `SSH_AUTH_SOCK` | System `SSH_AUTH_SOCK` | Path to active SSH agent socket |

Example:
```bash
PORT=9090 SHELL=/bin/zsh npm run start:backend
```

### Frontend Environment Variables (`.env` or inline)

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `VITE_BACKEND_URL` | `http://localhost:8088` | Origin of the backend gateway. The WebSocket URL is derived as `/ws` on this origin |
| `VITE_WS_URL` | *(unset)* | **Deprecated** alias holding a full `ws://` URL. Used only when `VITE_BACKEND_URL` is unset |
| `VITE_DEMO_MODE` | *(unset)* | Set to `1` for explicit Demo mode (simulated terminal output, no backend). Adding `?demo=1` to the page URL also works |

Example:
```bash
VITE_BACKEND_URL=http://localhost:9090 npm run start:frontend
```

For the gateway's security model and variables see [server/README.md](../server/README.md).

### Remote access

Pointing the frontend at a non-loopback `ws://` address is not supported directly: the gateway binds to loopback only and has no authentication or TLS until Phase 8. Until then, use an SSH local port forward to the loopback-bound gateway:

```bash
ssh -L 8088:127.0.0.1:8088 user@remote-host
```

Then open the frontend locally; it keeps talking to `http://localhost:8088`.

### Connection states

The header chip and the banner below it always show the true connection state:

| Chip | Banner | Meaning |
| :--- | :--- | :--- |
| **Connecting** | none | First connection attempt in progress |
| **Connected** | none | Live and healthy |
| **Reconnecting (attempt N)** | "Connection lost", countdown and a **Retry now** button | The link dropped; the client retries with jittered exponential backoff and a heartbeat |
| **Disconnected** | "Disconnected from backend" with a **Reconnect** button | Retries stopped; click Reconnect to try again |
| **Auth failed** | "Authentication failed" | The backend rejected the connection; no retry is offered |
| **DEMO** | "Demo mode" | Explicit Demo mode: output is simulated and no backend is connected |

### Agent roster

In live mode the pane list starts empty and follows the gateway, including tmux sessions the gateway rediscovered at startup. Every create, close and kill is sent with a request id and confirmed by the gateway, which answers with the server's agent or a typed error within 10 seconds. Add Agent shows a pane in a Starting state at once, and it becomes the real terminal when the gateway confirms; if the app is not connected, the gateway refuses, or it does not confirm within 10 seconds, the pane disappears and an error notice says why. A refused action (for example a session kill without confirmation) shows the gateway's reason at once. Closing an agent stays pending until the gateway confirms; if the close is not confirmed within 10 seconds, the pane stays in place and an error notice is shown. Closing an agent (the trash control) only removes it from the roster and leaves its tmux session running, so you can re-attach by adding an agent with the same session name. To end the session itself, use "Kill tmux session..." in the pane footer (live mode, tmux agents only): it asks for confirmation naming the agent, the session and the command, and only the dialog's "Kill session" button sends the request. The pane disappears once the gateway confirms. The gateway acts only on an explicit confirmation and only for sessions of agents it manages.

The pane list follows the gateway's added, removed and updated events (so an agent created or closed from another tab, the HTTP API or a script appears or disappears without a reload) and a full list on connect and reconnect, without duplicates. Requests still in flight when the connection drops are re-sent once the connection returns and are safe to repeat; a create that was sent just before a disconnect appears once. Errors that belong to no request appear as a notice. Rename, tags and group are available through the store's `updateAgent` action and the gateway, but have no UI yet, and stale markers are not available. Demo mode keeps its seed agents and simulated behavior and ignores all gateway events.

---

## 5. Running Tests & Verifying Builds

### Run Test Suites
```bash
# Run Frontend component & unit tests
npm test

# Run Backend server unit & integration tests
cd server && npm test
```

### Verify Production Bundles
```bash
# Test frontend & backend TypeScript compilation
npm run build && cd server && npm run build
```

---

## 6. Troubleshooting & Edge Cases

### Issue 1: `EADDRINUSE: address already in use :::8088`
- **Cause**: Another process is occupying port `8088`.
- **Solution**: Pass a custom `PORT` variable when launching the backend:
  ```bash
  PORT=8090 ./scripts/start-all.sh
  ```

### Issue 2: `tmux: command not found`
- **Cause**: `tmux` is not installed on the local system.
- **Solution**: Install `tmux` via package manager:
  - Ubuntu/Debian: `sudo apt install tmux`
  - macOS: `brew install tmux`
  *(Note: If tmux is absent, local agent creation degrades gracefully and SSH agents remain fully functional).*

### Issue 3: `SSH Authentication Error`
- **Cause**: The SSH key or agent is not authorized on the target host.
- **Solution**:
  1. Ensure your SSH agent is running and keys are added (`ssh-add -l`).
  2. Verify you can connect directly via terminal: `ssh admin@target-host`.
  3. Ensure your public key is in `~/.ssh/authorized_keys` on the remote host.

### Issue 4: Banner stuck on "Reconnecting"
- **Cause**: The backend is not running, the port or `VITE_BACKEND_URL` is wrong, or the browser origin is not listed in `ALLOWED_ORIGINS` and the WebSocket upgrade is rejected with HTTP 403.
- **Solution**: Start the backend (`npm run start:backend`), check the URL and port, and add your page origin to `ALLOWED_ORIGINS` if you serve the frontend from a non-default origin.

### Issue 5: Unexpected `DEMO` chip
- **Cause**: `VITE_DEMO_MODE` is set, or the page URL contains `?demo=1`.
- **Solution**: Unset `VITE_DEMO_MODE` (check `.env` files and your shell) and remove `?demo=1` from the URL.

### Issue 6: Stray characters such as `1;2c` at the prompt, or a mangled first command
- **Cause**: A program in the shell (tmux at attach, some shells and editors) asks the terminal who it is or what colours it uses. A browser terminal that answers types the answer into the shell, which shows up as text like `1;2c0;276;0c` and corrupts the next command. The app therefore does not answer terminal queries (device attributes, cursor-position and status reports, mode and colour queries).
- **Solution**: Nothing to configure. If a program insists on an answer it falls back after its own timeout. The table of suppressed queries is in `src/components/agent/terminalReports.ts`.
  - Real keystrokes and paste are unaffected.
  - Focus and mouse reports that a program explicitly enabled are unaffected.

### Issue 7: A closed agent's tmux session is still running
- **Cause**: Closing an agent never kills its tmux session, by design.
- **Solution**: Use "Kill tmux session..." in the pane footer before closing. From a terminal you can list sessions with `tmux list-sessions` and end one with `tmux kill-session -t <name>`. Use this manual alternative too for sessions whose names contain spaces or other unusual characters (the gateway refuses to kill those) and for sessions that have no agent.
