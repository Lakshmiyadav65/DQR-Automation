import { defineConfig, devices } from '@playwright/test';

/**
 * This project does not use the Playwright test runner — the entrypoint is
 * `src/index.ts`, which drives a Chromium instance programmatically. This
 * config exists for IDE integration and for `npx playwright codegen`, and
 * documents the defaults the runner also applies at launch time.
 */
export default defineConfig({
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
});
