/**
 * Once per run, before any worker starts: start the run's loopback Storage, then create, migrate and seed the run's
 * throwaway store, and hand both to the workers through the environment they inherit. The function it returns is
 * Playwright's run teardown, which drops the store and stops the Storage.
 *
 * The Storage key is generated here and lives only in this process's environment and its workers'; it is never
 * printed or written to a file.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { E2E_OBJECTS_API_URL_ENV, E2E_OBJECTS_SERVICE_KEY_ENV } from "../../../store/objects/e2eSelection.js";
import { createRunStore, RUN_STORE_URL_ENV, storeAdminUrl } from "./consoleSeed.js";
import { startFakeObjectStorage } from "./fakeObjectStorage.js";

/**
 * Start the run's Storage, create the run's store, and publish both.
 *
 * @returns how to drop the store and stop the Storage, which Playwright calls as the run's teardown
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const objects = await startFakeObjectStorage();
  process.env[E2E_OBJECTS_API_URL_ENV] = objects.apiUrl;
  process.env[E2E_OBJECTS_SERVICE_KEY_ENV] = objects.serviceKey;
  const home = mkdtempSync(join(tmpdir(), "sw-e2e-seed-"));
  try {
    const store = await createRunStore({ adminUrl: storeAdminUrl(), home });
    process.env[RUN_STORE_URL_ENV] = store.url;
    return async () => {
      try {
        await store.drop();
      } finally {
        await objects.stop();
      }
    };
  } catch (error) {
    await objects.stop();
    throw error;
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
}
