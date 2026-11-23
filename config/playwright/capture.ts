/**
 * `browser console-shot`'s Playwright config: the console lane's own global setup and worker fixtures
 * (`src/__tests__/e2e/fixtures/`), so the walk runs over a throwaway store and a throwaway home seeded with the
 * synthetic organisation, collecting only the capture walks (`src/__tests__/e2e/capture/*.capture.ts`). One worker,
 * no retry, no trace or video: one walk is asked for by `--grep`, and a retry would photograph a second run under the
 * first one's name.
 *
 * Only the verb runs it, which builds the CLI and the console first and names the walk and the capture directory.
 * The viewport and the headless browser are the console lane's (`./console.ts`), so a walk photographs the frame the
 * lane's specs assert on.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 15_000 },
  forbidOnly: true,
  fullyParallel: false,
  globalSetup: "../../src/__tests__/e2e/fixtures/globalSetup.ts",
  outputDir: "../../test-results/playwright-capture",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { height: 1080, width: 1920 } } }],
  reporter: [["list"]],
  retries: 0,
  testDir: "../../src/__tests__/e2e/capture",
  testMatch: "**/*.capture.ts",
  timeout: 120_000,
  use: {
    actionTimeout: 10_000,
    headless: true,
    navigationTimeout: 30_000,
    screenshot: "off",
    trace: "off",
    video: "off",
    viewport: { height: 1080, width: 1920 },
  },
  workers: 1,
});
