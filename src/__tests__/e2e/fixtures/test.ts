/**
 * The one `test` every console spec imports, the archive suite's `fixtures/test.ts` in this repository's terms:
 *
 * - `console` (worker-scoped): the worker's own seeded home and `next start` (`./consoleWorker.ts`);
 * - `baseURL`: that console's origin, so a spec navigates by path.
 *
 * Every test gets a fresh browser context, so local storage, cookies and the voice's saved state never cross tests.
 */
import { test as base, expect } from "@playwright/test";

import { E2E_OBJECTS_API_URL_ENV, E2E_OBJECTS_SERVICE_KEY_ENV } from "../../../store/objects/e2eSelection.js";
import { RUN_STORE_URL_ENV } from "./consoleSeed.js";
import { type ConsoleWorker, startConsoleWorker } from "./consoleWorker.js";

/**
 * One variable global setup leaves for the workers, refused by name when it is missing. Only the name is ever printed:
 * the Storage key among them is never written anywhere.
 *
 * @param name the variable global setup sets
 * @returns its value
 */
function fromGlobalSetup({ name }: { name: string }): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is unset: global setup did not start the run's store and Storage`);
  }
  return value;
}

/**
 * How long a step waiting on one of the console's live reads may take. Each read spawns a CLI verb, and a page opens on
 * twenty or more of them, which the console answers behind one another. MEASURED on a dev Mac, three workers:
 * the first Queue row drew 11.4s after the open. Reproduce with `--trace on` and the trace's network tab, reading
 * `/api/live/landing-reading`.
 */
export const LIVE_READ_TIMEOUT_MS = 45_000;

/** What every worker holds for its tests. */
interface ConsoleWorkerFixtures {
  readonly console: ConsoleWorker;
}

/** The console lane's `test`. */
export const test = base.extend<object, ConsoleWorkerFixtures>({
  baseURL: async ({ console }, use) => {
    await use(console.origin);
  },
  console: [
    async ({ playwright: _playwright }, use, workerInfo) => {
      const storeUrl = fromGlobalSetup({ name: RUN_STORE_URL_ENV });
      const objects = {
        apiUrl: fromGlobalSetup({ name: E2E_OBJECTS_API_URL_ENV }),
        serviceKey: fromGlobalSetup({ name: E2E_OBJECTS_SERVICE_KEY_ENV }),
      };
      const running = await startConsoleWorker({ objects, storeUrl, workerIndex: workerInfo.workerIndex });
      // This worker's process takes its own homes for as long as it holds the console, and gives the run's back after.
      const previous = Object.keys(running.processEnv).map((name) => ({ name, value: process.env[name] }));
      Object.assign(process.env, running.processEnv);
      try {
        await use(running);
      } finally {
        for (const { name, value } of previous) {
          if (value === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = value;
          }
        }
        await running.stop();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
});

export { expect };
