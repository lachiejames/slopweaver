/**
 * Close every TypeScript seam client after each test file, the Vitest owner of `src/lib/tsLifecycle.ts`'s normal
 * close. Loaded by every lane's `setupFiles` (`config/vitest/base.ts`'s `TYPESCRIPT_LIFECYCLE_SETUP`). The unit
 * lane reuses one fork across files (`isolate: false`), so the registry is the WORKER's, not the file's: closing
 * it after each file empties it, which closes exactly the clients that file opened before the next one runs. The
 * exit backstop stays armed once per worker. A KILLED worker never reaches it, and needs not to: on TypeScript 7.1 the Go server exits
 * on the closed pipe. On TypeScript 6 every registered closer is a no-op.
 */
import { afterAll } from "vitest";

import { closeTypeScript } from "../lib/tsLifecycle.js";

afterAll(() => {
  closeTypeScript();
});
