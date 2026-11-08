# QA driver: docs/qa-test-plan.md section 5 (live stack)

Playwright driver for the manual QA in `docs/qa-test-plan.md` (steps 1, 1a-1c, 2-12). It runs against the stack that is
already running (frontend, gateway, real tmux). It never starts or stops servers and never touches `qa-agent-*` tmux
sessions; it only creates and removes agents/sessions named `qa-e2e-*`.

## Run

    cd qa && npm ci && npx playwright test

Env overrides: `QA_BASE_URL` (default `http://localhost:3000`), `QA_BACKEND_URL` (default `http://localhost:8089`),
Uses installed Google Chrome (`channel: 'chrome'`).

Prerequisites: tmux, Google Chrome, and a system `ffmpeg` with libvpx-vp9 (Playwright 1.64 wants its own ffmpeg build
at `~/.cache/ms-playwright/ffmpeg-1013`; if it is missing, run `npx playwright install ffmpeg`).

## Layout

- `e2e/manual-qa.e2e.ts` - one test, one page, steps run in order (`test.step`), so a single `video.webm` covers the whole session. A failing step is recorded and the run continues.
- `e2e/manual-qa-fixme.e2e.ts` - steps 1a and 1c as `test.fixme` (need the gateway stopped/restarted).
- Specs are named `*.e2e.ts` so root vitest (`*.test.*`/`*.spec.*`) never collects them.

## Output (git-ignored except QA-REPORT.md)

- `test-results/<test>/video.webm` - whole-run video
- `test-results/steps/*.png` - one screenshot per step; `test-results/step-results.json` - per-step PASS/FAIL
- `playwright-report/index.html` - html report (`npx playwright show-report`)
- `QA-REPORT.md` - written summary of the last run
