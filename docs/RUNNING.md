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
| `SHELL` | `/bin/bash` | Default shell binary used by PTY driver |
| `SSH_AUTH_SOCK` | System `SSH_AUTH_SOCK` | Path to active SSH agent socket |

Example:
```bash
PORT=9090 SHELL=/bin/zsh npm run start:backend
```

### Frontend Environment Variables (`.env` or inline)

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `VITE_WS_URL` | `ws://localhost:8088/ws` | WebSocket backend URL |

Example:
```bash
VITE_WS_URL=ws://192.168.1.50:8088/ws npm run start:frontend
```

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
