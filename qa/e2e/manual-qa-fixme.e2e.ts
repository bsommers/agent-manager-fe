import { test } from '@playwright/test';

// Steps that cannot be automated safely against the shared live stack.
test.fixme('1a. Gateway stopped: Add Agent shows no pane and a "backend not connected" notice', async () => {
  // Requires stopping the gateway on :8089; this driver must not start or stop dev servers.
});

test.fixme('1c. Gateway restarted with page open: roster reconciles to the gateway list, no duplicates', async () => {
  // Requires restarting the gateway; this driver must not start or stop dev servers.
});
