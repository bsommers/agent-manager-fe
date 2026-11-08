# QA report: manual QA section 5 against the live stack

Run: 2026-11-07, Playwright 1.64.1, Google Chrome (channel), viewport 1440x900, frontend :3000, gateway :8089, real tmux.
Result: 12 PASS, 4 FAIL, 2 FIXME (16 executed steps + 2 fixme). All 4 failures are app bugs (below), not driver bugs.

## Per-step results

| Step | Result | Note |
|---|---|---|
| 0 Preflight | PASS | Chip is `data-mode=live`, `data-state=open`, text Connected |
| 1 Add qa-e2e-a / qa-e2e-b | PASS | Pending pane resolves to one confirmed pane each, shell prompt visible in `.xterm-rows`, tmux sessions exist. The transient Starting label is not asserted (too short-lived to observe reliably) |
| 1a Gateway down, Add Agent | FIXME | Needs the gateway stopped; driver must not stop servers |
| 1b Reload | PASS | Both panes restored after reload, exactly one each, no pending leftovers |
| 1c Gateway restart reconcile | FIXME | Needs the gateway restarted; driver must not stop servers |
| 1e (extra) Clean prompt | FAIL | BUG 1: terminal-query replies are typed into the shell |
| 2 Select both, bar shows 2 targets | PASS | "2 agents targeted" with Selected mode |
| 3 echo qa-broadcast-ok in both panes | FAIL | BUG 1 corrupts the command (`0cecho`), output never printed |
| 4 sudo command opens safety modal | PASS | alertdialog shown with the command |
| 5 Cancel closes modal, nothing sent | FAIL | BUG 2: Cancel button is covered by a pane; click intercepted |
| 6 Ctrl+Shift+F opens search | PASS | |
| 7 Search qa-broadcast-ok | PASS | One group each for qa-e2e-a and qa-e2e-b (hit is the echoed typed text, see bug 1) |
| 8 Regex qa-broadcast-.+ | PASS | Results shown |
| 9 Regex invalid qa-( | PASS | "Invalid regular expression" alert, zero results, no crash |
| 10 Pick a hit | PASS | Modal closes, qa-e2e-b pane gets the active ring, qa-e2e-a does not |
| 11 exit in qa-e2e-b | PASS | Toast naming qa-e2e-b with disconnected/error |
| 12 Remove agents in UI | PASS | Both panes vanish after gateway confirms; qa-agent-1/2 untouched |
| 12b (extra) tmux session cleaned | FAIL | BUG 3 (possible): closing qa-e2e-a via UI left its tmux session running (qa-e2e-b had already exited in step 11). The plan is ambiguous on whether close should kill the session; the driver kills leftovers `qa-e2e-*` itself |

## Videos and artifacts

- Main whole-run video (single continuous session): `/home/bill/src/ui/agent-manager-fe/qa/test-results/manual-qa.e2e.ts-Manual-QA-b7c0c-ack-one-continuous-session-/video.webm`
- That is the only video (one test uses a page). The two fixme tests open no page, so they have none.
- Trace (failure): `qa/test-results/manual-qa.e2e.ts-Manual-QA-b7c0c-ack-one-continuous-session-/trace.zip`
- Per-step screenshots: `qa/test-results/steps/*.png`; per-step JSON with errors: `qa/test-results/step-results.json`
- HTML report: `/home/bill/src/ui/agent-manager-fe/qa/playwright-report/index.html`

## App bugs found

1. Terminal-query replies are forwarded to the shell as keystrokes (steps 1e, 3). On attach, tmux queries the terminal;
   xterm.js answers and the frontend sends `agent:input` frames `ESC[?1;2c`, `ESC[>0;276;0c`, `ESC]10;rgb:...`, `ESC]11;rgb:...`
   to the shell. The shell shows `1;2c0;276;0c` at the prompt and the next command is corrupted: `echo qa-broadcast-ok`
   ran as `0cecho qa-broadcast-ok` ("Command '0cecho' not found"), so the broadcast outcome of step 3 fails.
   Likely cause: `TerminalView` `onData` forwards xterm auto-replies.
   Evidence: `qa/test-results/steps/1e-terminal-prompt-is-clean-no-terminal-query-replies-e-g-1-.png`, `qa/test-results/steps/3-send-echo-qa-broadcast-ok-qa-broadcast-ok-printed-in-both-.png`.
   Assertion errors: step 1e `expect(received).not.toMatch(/\d+;\d+(;\d+)?c/)` received `"... ~ → 1;2c0;276;0cter ~ →"`; step 3
   `expect(received).toMatch(/^qa-broadcast-ok\s*$/m)` timed out, received `echo qa-broadcast-ok / 2c0: command not found / 276: command not found / Command '0cecho' not found`.
2. Destructive safety modal is stacked under the panes (step 5). The modal is `fixed z-50`, panes use inline z-index 100+,
   so the panes overlay the modal and the Cancel button cannot be clicked (the keyboard Escape still closes it).
   Evidence: `qa/test-results/steps/4-destructive-command-sudo-opens-the-safety-modal.png` (panes drawn over the modal) and
   `qa/test-results/steps/5-cancel-modal-closes-and-nothing-is-sent-to-either-pane.png`.
   Assertion error: `locator.click: Timeout 5000ms exceeded ... <span>PANE [qa-e2e-b]</span> from <div class="flex-1 relative overflow-hidden ...">
   subtree intercepts pointer events`.
3. (Possible) Closing a tmux agent from the UI leaves its tmux session running (step 12b).
   Evidence: `qa/test-results/steps/12b-closing-agents-via-the-ui-leaves-no-qa-e2e-tmux-session-.png`.
   Assertion error: `expect(received).toEqual(expected)`, expected `[]`, received `["qa-e2e-a"]` (tmux sessions prefixed qa-e2e-).

## Driver notes

- Playwright 1.64.1 (released 2026-10-14) is pinned; the cached Chromium builds do not match it, so `channel: 'chrome'` is used.
- Video encoding failed with the cached ffmpeg build ("Option not found"); `~/.cache/ms-playwright/ffmpeg-1013/ffmpeg-linux` is a symlink to `/usr/bin/ffmpeg`. Nothing was downloaded.
- Step 2 note: the bar preselects the active agent (e.g. qa-agent-1); the driver unchecks every agent except ours so
  broadcasts never reach `qa-agent-*`. (An earlier iteration of the driver, before this was fixed, sent one harmless `echo` to qa-agent-1.)
- Root `npm test` after the run: 58 files / 753 tests passed, none from `qa/` (root HEAD has moved since the 44-file baseline; `vitest list` shows zero `qa/` files).
