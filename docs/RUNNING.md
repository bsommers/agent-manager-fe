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
| `HOST` | `127.0.0.1` | Interface the gateway binds to. A non-loopback value is accepted only when `AGENT_MANAGER_TOKEN` is set; otherwise start-up is refused with a message naming `HOST` and `AGENT_MANAGER_TOKEN` |
| `AGENT_MANAGER_TOKEN` | *(unset)* | Shared secret. Unset or empty means no authentication (zero-config local use, loopback only). When set it must be 24 to 512 printable ASCII characters (no spaces or control characters, a trailing newline counts), is checked even on loopback, and is never trimmed. Generate one with `openssl rand -base64 32`. Load it from a secret store or an untracked env file; do not put it on a command line other users can read |
| `AGENT_MANAGER_TRUST_PROXY` | unset (auto) | Unset: when the socket peer is loopback (your local reverse proxy) the auth throttle is keyed by the last `X-Forwarded-For` entry instead of the peer address; a non-loopback peer is always keyed by its own address and its header is ignored. `1`/`true` behaves the same; `0`/`false` ignores the header entirely. Use a proxy that overwrites that header (see the nginx example below) |
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

### Authentication

Local use stays zero-config: with `AGENT_MANAGER_TOKEN` unset the gateway binds loopback and needs no token. Set the variable and authentication is enforced on every surface, including loopback:

```bash
# Read the secret from a store or an untracked file; never commit it.
export AGENT_MANAGER_TOKEN="$(openssl rand -base64 32)"
npm run start:backend
```

- **WebSocket**: with a token, the gateway sends nothing until the first frame is a valid `hello` carrying the token (`{ "type": "hello", "contract": 1, "token": "..." }`) within 5 seconds. It answers `hello_ack` (contract, epoch, `auth.required`, limits, backends) and then `agent:init_list`. A wrong, missing or malformed token, a first frame over 16 KiB, a first frame that is not a `hello` and the 5 second deadline all close the socket with code `4401` (reason `unauthenticated`).
- **HTTP**: every `/api` route except the minimal `GET /api/health` needs `Authorization: Bearer <token>`; otherwise `401 UNAUTHENTICATED` with `WWW-Authenticate: Bearer`. The token is never read from a URL, cookie or body.
- **Health**: `GET /api/health` without a header returns the minimal form (`ok`, `contract`, `epoch`, `backends`); with a valid Bearer it also returns `agents`; a wrong Bearer is a counted `401`. The legacy `GET /health` drops `agents` when a token is set.
- **Throttle**: 5 wrong tokens within 60 seconds from one source lock it for 60 seconds, doubling up to 15 minutes. A locked source gets close code `4429` (reason `retry-after-ms=N`) on WebSocket and `429 RATE_LIMITED` with `Retry-After` on HTTP, even with the right token. Only wrong tokens count. WebSocket and HTTP share one table (at most 10 000 sources; IPv6 sources are keyed by their /64).
- **Logging**: the token, frames and headers are never logged; JSON parse errors are reported with a fixed message.
- **Bind rule**: a non-loopback `HOST` needs a valid token, otherwise the gateway refuses to start.

To query a running gateway without putting the token on the command line, write it from the environment into a private curl config file:

```bash
umask 077
printf 'header = "Authorization: Bearer %s"\n' "$AGENT_MANAGER_TOKEN" > "$HOME/.agent-manager-curl"
curl -s -K "$HOME/.agent-manager-curl" "http://127.0.0.1:$PORT/api/agents"
```

(A `-H` header value is visible in the process list for the duration of the command.)

`server/scripts/smoke-auth.mjs` runs the built gateway on free ports and verifies all of the above end to end (`npm --prefix server run build && node server/scripts/smoke-auth.mjs`).

### Remote access

Two supported ways to reach a gateway from another machine. The gateway itself speaks plain HTTP and WS only; **TLS is terminated by a reverse proxy and in-gateway TLS is not built** (decision D-09).

**1. SSH local port forward (zero config).** Keep the gateway on loopback and forward its port:

```bash
ssh -L 8088:127.0.0.1:8088 user@remote-host
```

Then open the frontend locally; it keeps talking to `http://localhost:8088`.

**2. Token plus a TLS reverse proxy.** The gateway stays on loopback behind the proxy with `AGENT_MANAGER_TOKEN` set (`AGENT_MANAGER_TRUST_PROXY` needs no setting: a loopback proxy is trusted automatically). List the UI's https origin in `ALLOWED_ORIGINS` (the WebSocket upgrade and mutating `/api` calls check `Origin`), and build the frontend with `VITE_BACKEND_URL` set to the https gateway origin. The frontend refuses `http://` / `ws://` to any non-loopback host, so a plaintext remote backend shows a configuration error and opens no socket.

Example nginx server block. It assumes the gateway runs with `PORT=9090` on `127.0.0.1`; match the port to your `PORT`. Nothing here asks you to move or stop whatever already listens elsewhere.

```nginx
server {
    listen 443 ssl;
    server_name agent.example.com;

    # Point these at your certificate files.
    ssl_certificate     /etc/ssl/agent.example.com/fullchain.pem;
    ssl_certificate_key /etc/ssl/agent.example.com/privkey.pem;

    location /ws {
        proxy_pass http://127.0.0.1:9090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # The gateway's DNS-rebinding guard accepts only loopback names (or the configured HOST) here.
        proxy_set_header Host 127.0.0.1:9090;
        # OVERWRITE, never append: the gateway keys its throttle on the last entry, so the last entry
        # must be the address nginx saw, not a value the client supplied.
        proxy_set_header X-Forwarded-For $remote_addr;
        # Keep an idle terminal socket open (the gateway pings every 30 s).
        proxy_read_timeout 3600s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:9090;
        proxy_set_header Host 127.0.0.1:9090;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

With that proxy, start the gateway as:

```bash
PORT=9090 ALLOWED_ORIGINS=https://agent.example.com \
  AGENT_MANAGER_TOKEN="$(cat /path/to/secret)" npm run start:backend
```

The forwarded header is honoured only when the connecting peer is loopback, so a client reaching the gateway directly cannot choose its throttle key. A proxy that appends to `X-Forwarded-For` (instead of overwriting) or a client on the gateway host itself can still pick its own key; set `AGENT_MANAGER_TRUST_PROXY=0` to ignore the header, in which case all proxied clients share one throttle key (see Troubleshooting).

In the browser: the token dialog opens on authentication failure, the token is kept in the tab's session storage (key `agent-manager.token`) and cleared on **Log out** or when the tab closes, and **Log out** is in the header and the command palette while a token is set. Log out empties the roster, log buffers and the token, and removes every `agent-manager.*` storage key.

### Connection states

The header chip and the banner below it always show the true connection state:

| Chip | Banner | Meaning |
| :--- | :--- | :--- |
| **Connecting** | none | First connection attempt in progress |
| **Connected** | none | Live and healthy |
| **Reconnecting (attempt N)** | "Connection lost", countdown and a **Retry now** button | The link dropped; the client retries with jittered exponential backoff and a heartbeat |
| **Disconnected** | "Disconnected from backend" with a **Reconnect** button | Retries stopped; click Reconnect to try again |
| **Auth failed** | "Authentication failed" with an **Enter token** button | The gateway closed the socket with `4401` (wrong or missing token), or did not acknowledge the hello within 3 seconds. The client stops retrying until you submit a token in the dialog |
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

### Issue 8: The gateway refuses to start naming `HOST` or `AGENT_MANAGER_TOKEN`
- **Cause**: `HOST` is not a loopback address and no token is set, or the token is shorter than 24 or longer than 512 characters, or contains a space, a non-ASCII character or a control character. A trailing newline (for example from `echo` or an env file) counts as a control character; the gateway never trims the secret.
- **Solution**: Set a valid token (`openssl rand -base64 32`; use `printf %s` when writing it to a file so no newline is added) or bind `127.0.0.1`. The message states the rule but never the value.

### Issue 9: "Authentication failed" again after entering the token
- **Cause**: The token differs from the gateway's (check for a stale shell or a trailing newline), or the source is throttled after repeated wrong tokens, or the proxy sends a `Host` the gateway rejects.
- **Solution**: Re-enter the token. If the connection is closed with `4429`, wait for the lock to lapse (60 seconds at first). Check the proxy's `Host` line (Issue 12).

### Issue 10: Everyone is locked out (`4429` / `429`) behind a proxy
- **Cause**: `AGENT_MANAGER_TRUST_PROXY=0` is set, or the proxy runs on another host (a non-loopback peer's `X-Forwarded-For` is never trusted), so every proxied client has the proxy's address as its source and they share one throttle key.
- **Solution**: Run the proxy on the gateway host (loopback) with a config that overwrites `X-Forwarded-For` with `$remote_addr` (example above), and leave `AGENT_MANAGER_TRUST_PROXY` unset.

### Issue 11: "gateway did not acknowledge authentication" or "Plaintext ws:// ... is refused"
- **Cause**: For the first, the gateway is older than the authentication phase, or something between the browser and the gateway blocks the first frame; the client gives up after 3 seconds. For the second, `VITE_BACKEND_URL` is `http://` to a non-loopback host.
- **Solution**: Run a current gateway and check the proxy forwards WebSocket frames. Use an `https://` backend URL behind TLS, or a loopback host.

### Issue 12: `403 host not allowed` or `403 Origin not allowed` through the proxy
- **Cause**: The proxy forwards the public `Host` (the gateway accepts only `127.0.0.1`, `localhost`, `[::1]` or the configured `HOST`), or the browser origin is missing from `ALLOWED_ORIGINS` (the upgrade is refused with HTTP 403).
- **Solution**: Set `proxy_set_header Host 127.0.0.1:<gateway port>;` and add the UI's exact https origin to `ALLOWED_ORIGINS`.
