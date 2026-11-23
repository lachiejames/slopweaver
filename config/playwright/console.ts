/**
 * The console's browser lane: Playwright Test over the BUILT console, one seeded home and `next start` per worker
 * (`src/__tests__/e2e/fixtures/`). `yarn test:e2e` (`src/testLanes/desktopE2e.entry.ts`) builds the console and the CLI,
 * then runs this; locally, with both already built:
 *
 *   DESKTOP_E2E_STORE_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn playwright test --config config/playwright/console.ts
 *
 * The shape is the slopweaver-archive suite's (`apps/app/playwright.config.ts`): files in
 * parallel and tests within a file in order, one retry on CI, a trace on that retry, video and screenshots kept on
 * failure, Chromium's fake microphone. No `webServer`: it starts one server for the whole run, and the console reads
 * its home once at start, so each worker starts its own.
 */
import { defineConfig, devices } from "@playwright/test";

/** Whether this is a CI run, which retries once and caps the workers at the runner's measured width. */
const onCi = process.env["CI"] === "true";

export default defineConfig({
  expect: { timeout: 15_000 },
  // Every spec runs, or the lane fails: a focused `test.only` is refused here, a skip by the reporter below.
  forbidOnly: true,
  fullyParallel: false,
  globalSetup: "../../src/__tests__/e2e/fixtures/globalSetup.ts",
  outputDir: "../../test-results/playwright",
  // The device preset carries its own 1280x720 viewport, so the desktop window's width is restated after it.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { height: 1080, width: 1920 } } }],
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../../playwright-report" }],
    ["../../src/__tests__/e2e/fixtures/noSkipReporter.ts"],
  ],
  retries: onCi ? 1 : 0,
  testDir: "../../src/__tests__/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  use: {
    actionTimeout: 10_000,
    headless: true,
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        // The voice spec answers the page's offer from a second peer in the same page (`fakeVoiceBackend.ts`), so the
        // call's only path is this machine to itself. Without loopback candidates the two peers can meet only on a LAN
        // address. MEASURED on a macOS host: without this flag the call stopped with "the network path did not hold"
        // on every run (hiding addresses behind mDNS or not), and with it the call connected in 4.3s. Why the LAN
        // path fails there is not proven; macOS's Local Network privacy check is the likely cause. Repro: drop the
        // flag, then `yarn test:e2e` on that Mac with DESKTOP_E2E_STORE_ADMIN_URL set.
        "--allow-loopback-in-peer-connection",
      ],
    },
    navigationTimeout: 30_000,
    permissions: ["microphone"],
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
    viewport: { height: 1080, width: 1920 },
  },
  workers: onCi ? 2 : 3,
});
