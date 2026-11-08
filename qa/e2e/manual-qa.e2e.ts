import { test, expect, type Page, type Locator, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE_URL = process.env.QA_BASE_URL ?? 'http://localhost:3000';
const BACKEND_URL = process.env.QA_BACKEND_URL ?? 'http://localhost:8089';
const A = 'qa-e2e-a';
const B = 'qa-e2e-b';
const RUN_DIR = path.resolve(__dirname, '../test-results/whole-run');
const SHOTS = path.resolve(__dirname, '../test-results/steps');


type StepResult = { id: string; title: string; status: 'PASS' | 'FAIL'; error?: string; screenshot?: string };
const results: StepResult[] = [];
let page: Page;
let testInfo: TestInfo;

const paneOf = (name: string): Locator =>
  page.locator('div[style*="position: absolute"]').filter({ hasText: `PANE [${name}]` });
const termText = async (name: string) =>
  (await paneOf(name).locator('.xterm-rows').first().innerText().catch(() => '')) ?? '';
const tmuxSessions = (): string[] => {
  try {
    return execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { return []; }
};
function killQaSessions() {
  for (const s of tmuxSessions().filter((n) => n.startsWith('qa-e2e-'))) {
    try { execFileSync('tmux', ['kill-session', '-t', s]); } catch { /* ignore */ }
  }
}
const chip = () => page.getByTestId('connection-chip');

/** Close every qa-e2e-* pane through the UI (stale ones from earlier runs, or ours). */
async function closeQaPanesViaUi() {
  const panes = () => page.locator('div[style*="position: absolute"]').filter({ hasText: /PANE \[qa-e2e-/ });
  for (let guard = 0; guard < 10 && (await panes().count()) > 0; guard++) {
    const p = panes().first();
    const close = p.getByTitle('Close Agent');
    if (await close.count()) await close.click(); else await p.getByRole('button', { name: /Cancel starting/ }).click();
    await page.waitForTimeout(1500);
  }
}

async function addAgent(name: string, host: string) {
  await page.getByRole('button', { name: 'New Agent' }).click();
  const dlg = page.getByRole('dialog', { name: /Register New AI Agent/ });
  await dlg.getByLabel('Agent Name').fill(name);
  await dlg.getByLabel('Tmux Session Name').fill(host);
  await dlg.getByRole('button', { name: 'Start Agent' }).click();
}

// Tests run in file order on one worker; a failure does not skip later steps.


/** Run one plan step as a Playwright step; record the outcome and keep going on failure. */
async function step(id: string, title: string, fn: () => Promise<void>) {
  let err: unknown;
  await test.step(`${id}. ${title}`, async () => {
    try { await fn(); } catch (e) { err = e; }
  });
  const slug = `${id}-${title}`.replace(/[^a-z0-9]+/gi, '-').slice(0, 60).toLowerCase();
  const shot = path.join(SHOTS, `${slug}.png`);
  await page.screenshot({ path: shot }).catch(() => {});
  await testInfo.attach(`step ${id}`, { path: shot, contentType: 'image/png' }).catch(() => {});
  const msg = err ? String((err as Error).message ?? err).replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 22).join('\n') : undefined;
  results.push({ id, title, status: err ? 'FAIL' : 'PASS', error: msg, screenshot: shot });
  console.log(`${err ? 'FAIL' : 'PASS'}  step ${id}: ${title}${msg ? '\n      ' + msg.split('\n').slice(0, 3).join('\n      ') : ''}`);
}

const searchBox = () => page.getByLabel('Search terminal logs');
const resultItems = () => page.getByTestId('search-result-item');

test.afterAll(async () => {
  killQaSessions(); // only qa-e2e-* tmux sessions; qa-agent-1/2 are never touched
});

test('Manual QA section 5 against the live stack (one continuous session)', async ({ page: p }, info) => {
  test.setTimeout(8 * 60_000);
  page = p;
  testInfo = info;
  fs.mkdirSync(SHOTS, { recursive: true });

  await page.goto('/');
  await expect(chip()).toHaveAttribute('data-state', 'open');
  await page.locator('div[style*="position: absolute"]').first().waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await closeQaPanesViaUi();
  killQaSessions(); // closing a pane via the UI leaves the tmux session; sweep our own prefixed leftovers
  expect(await page.getByText(/PANE \[qa-e2e-/).count(), 'stale qa-e2e panes remain').toBe(0);

  await step('0', 'Preflight: backend reachable, chip shows Connected (live mode)', async () => {
    const r = await fetch(BACKEND_URL).catch(() => null);
    expect(r, `backend ${BACKEND_URL} reachable`).not.toBeNull();
    await expect(chip()).toHaveAttribute('data-mode', 'live');
    await expect(chip()).toHaveAttribute('data-state', 'open');
    await expect(chip()).toContainText('Connected');
  });

  await step('1', 'Add qa-e2e-a and qa-e2e-b: Starting becomes a confirmed pane with a shell prompt', async () => {
    for (const n of [A, B]) {
      await addAgent(n, `localhost:${n}`);
      await expect(paneOf(n).first()).toBeVisible();
    }
    for (const n of [A, B]) {
      await expect(paneOf(n).getByTestId('pane-state-starting')).toHaveCount(0, { timeout: 20_000 });
      await expect(paneOf(n)).toHaveCount(1);
      await expect(paneOf(n).locator('.xterm-rows')).toBeVisible();
      await expect.poll(() => termText(n), { timeout: 20_000, message: `shell prompt in ${n}` }).toMatch(/[$#%>❯→]\s*$/m);
    }
    expect(tmuxSessions()).toEqual(expect.arrayContaining([A, B]));
  });

  await step('1e', 'Terminal prompt is clean: no terminal-query replies (e.g. 1;2c0;276;0c) typed into the shell', async () => {
    for (const n of [A, B]) {
      expect(await termText(n), `fragment in ${n}`).not.toMatch(/\d+;\d+(;\d+)?c/);
    }
  });

  await step('1b', 'Reload: both panes restored without Add Agent, no duplicates', async () => {
    await page.reload();
    await expect(chip()).toHaveAttribute('data-state', 'open');
    await expect(paneOf(A)).toHaveCount(1);
    await expect(paneOf(B)).toHaveCount(1);
    await page.waitForTimeout(1500);
    await expect(paneOf(A)).toHaveCount(1);
    await expect(paneOf(B)).toHaveCount(1);
    await expect(page.getByTestId('pane-state-starting')).toHaveCount(0);
  });

  await step('2', 'Broadcast bar, mode Selected, both agents: bar shows 2 targets', async () => {
    await page.getByRole('button', { name: 'Broadcast', exact: true }).first().click();
    await page.getByRole('button', { name: 'Selected', exact: true }).click();
    const boxes = page.getByRole('checkbox');
    await expect(boxes.first()).toBeAttached();
    const names = await boxes.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    // check ours first (so the selection never empties), then uncheck every other agent
    for (const want of [true, false]) {
      for (const name of names.filter((n) => (n === A || n === B) === want)) {
        const b = page.getByRole('checkbox', { name, exact: true });
        if ((await b.isChecked()) !== want) await b.locator('xpath=ancestor::label').click();
        await expect(b).toBeChecked({ checked: want });
      }
    }
    await expect(page.getByText(/2 agents targeted/)).toBeVisible();
  });

  await step('3', 'Send echo qa-broadcast-ok: qa-broadcast-ok printed in both panes', async () => {
    const input = page.getByPlaceholder(/Broadcast command/);
    await input.fill('echo qa-broadcast-ok');
    await input.press('Enter');
    for (const n of [A, B]) {
      await expect.poll(() => termText(n), { timeout: 15_000, message: `output in ${n}` }).toMatch(/^qa-broadcast-ok\s*$/m);
    }
  });

  await step('4', 'Destructive command (sudo ...) opens the safety modal', async () => {
    const input = page.getByPlaceholder(/Broadcast command/);
    await input.fill('sudo qa-e2e-never-run');
    await input.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toContainText('sudo qa-e2e-never-run');
  });

  await step('5', 'Cancel: modal closes and nothing is sent to either pane', async () => {
    try {
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click({ timeout: 5_000 });
    } catch (e) {
      await page.keyboard.press('Escape'); // keep the session usable for later steps; the click failure is still reported
      throw e;
    }
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page.waitForTimeout(1500);
    for (const n of [A, B]) expect(await termText(n)).not.toContain('qa-e2e-never-run');
  });

  await step('6', 'Ctrl+Shift+F opens the global search modal', async () => {
    await page.locator('body').click({ position: { x: 5, y: 450 } });
    await page.keyboard.press('Control+Shift+F');
    await expect(page.getByRole('dialog', { name: /search/i })).toBeVisible();
  });

  await step('7', 'Search qa-broadcast-ok: hits from both agents', async () => {
    await searchBox().fill('qa-broadcast-ok');
    await expect(resultItems().first()).toBeVisible();
    const groups = page.getByTestId('agent-group-name');
    await expect(groups.filter({ hasText: A })).toHaveCount(1);
    await expect(groups.filter({ hasText: B })).toHaveCount(1);
  });

  await step('8', 'Regex on, qa-broadcast-.+ shows results', async () => {
    await page.getByRole('button', { name: 'Regex' }).click();
    await expect(page.getByRole('button', { name: 'Regex' })).toHaveAttribute('aria-pressed', 'true');
    await searchBox().fill('qa-broadcast-.+');
    await expect(resultItems().first()).toBeVisible();
  });

  await step('9', 'Regex on, invalid qa-( shows invalid-expression message and no results', async () => {
    await searchBox().fill('qa-(');
    await expect(page.getByRole('alert').filter({ hasText: /Invalid regular expression/ })).toBeVisible();
    await expect(resultItems()).toHaveCount(0);
  });

  await step('10', 'Regex off, choose a hit: modal closes and that agent pane is focused', async () => {
    await page.getByRole('button', { name: 'Regex' }).click();
    await searchBox().fill('qa-broadcast-ok');
    const group = page.getByTestId('agent-group-name').filter({ hasText: B });
    await expect(group).toHaveCount(1);
    await page.locator('[data-testid^="agent-group-"]').filter({ has: group }).getByTestId('search-result-item').first().click();
    await expect(page.getByRole('dialog', { name: /search/i })).toHaveCount(0);
    await expect(paneOf(B).locator('div.ring-1').first()).toBeVisible();
    await expect(paneOf(A).locator('div.ring-1')).toHaveCount(0);
  });

  await step('11', 'exit in the qa-e2e-b shell raises a disconnected/error toast naming qa-e2e-b', async () => {
    await paneOf(B).locator('.xterm').click();
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
    const toast = page.locator('[data-testid^="toast-"]').filter({ hasText: B });
    await expect(toast).toBeVisible({ timeout: 15_000 });
    await expect(toast).toContainText(/disconnected|error/i);
  });

  await step('12', 'Remove qa-e2e-a and qa-e2e-b from the UI: panes vanish only after the gateway confirms', async () => {
    for (const n of [A, B]) {
      await paneOf(n).getByTitle('Close Agent').click();
      await expect(paneOf(n)).toHaveCount(0, { timeout: 20_000 });
    }
    expect(tmuxSessions()).toEqual(expect.arrayContaining(['qa-agent-1', 'qa-agent-2']));
  });

  await step('12b', 'Closing agents via the UI leaves no qa-e2e-* tmux session behind', async () => {
    await expect.poll(() => tmuxSessions().filter((x) => x.startsWith('qa-e2e-')), { timeout: 10_000 }).toEqual([]);
  });

  await closeQaPanesViaUi().catch(() => {});
  fs.writeFileSync(path.resolve(__dirname, '../test-results/step-results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === 'FAIL');
  expect(failed.map((f) => `${f.id}: ${f.title}`), `${failed.length} QA step(s) failed`).toEqual([]);
});
