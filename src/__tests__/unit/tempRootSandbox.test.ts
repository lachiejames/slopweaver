/**
 * The runtime witness for the temp-root sandbox (`src/__tests__/setup-temp-root.ts` and its run-level
 * sweep, `src/__tests__/global-temp-root.ts`).
 *
 * The sibling lane-config assertions in `ambientHomeGuard.test.ts` prove every config NAMES both files.
 * These prove they actually did something: if a lane ever drops the setup, `tmpdir()` answers the machine's
 * shared temp directory again and the first assertion here goes red, which is the whole point — the
 * 1,409,874 leaked fixture directories that motivated the sandbox accumulated silently, with a green suite.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEMP_ROOT_PARENT_VAR } from "../global-temp-root.js";
import { TEMP_ROOT_PREFIX } from "../setup-temp-root.js";

// register-class: test-fixture-mints-a-temp-dir-with-no-cleanup (docs/recurring-failure-register/bindings.md)

describe("the temp-root sandbox", () => {
  it("points $TMPDIR at this test file's own root rather than the shared temp directory", () => {
    expect(basename(tmpdir()).startsWith(TEMP_ROOT_PREFIX)).toBe(true);
    expect(process.env["TMPDIR"]).toBe(tmpdir());
  });

  it("nests that root inside the run's own parent, which the run-level sweep removes in one call", () => {
    // Named for the MAIN process's pid, not this worker's — that is what makes the sweep unable to touch a
    // concurrent vitest in another session. The pid is not asserted here, because which process is the
    // parent depends on the pool, and the wiring under test is the variable rather than the pool.
    expect(dirname(tmpdir())).toBe(process.env[TEMP_ROOT_PARENT_VAR]);
    expect(basename(dirname(tmpdir())).startsWith("sw-tmp-")).toBe(true);
  });

  // The reason the sandbox lives under the OS temp directory rather than the repo's own ignored scratch:
  // darwin caps a Unix socket path at 104 bytes, and `subprocess/cmux/fakeCmuxServer.ts` binds one at
  // `<tmpdir>/fake-cmux-XXXXXX/s.sock`. This is that budget, asserted rather than remembered.
  it("leaves a fake-cmux socket path inside darwin's 104-byte sun_path cap", () => {
    const socket = join(tmpdir(), "fake-cmux-abc123", "s.sock");

    expect(socket.length).toBeLessThan(104);
  });

  it("catches a fixture that is never cleaned up, because the whole root is removed", () => {
    const leaked = mkdtempSync(join(tmpdir(), "deliberate-leak-"));

    expect(dirname(leaked)).toBe(tmpdir());
    // Removed here only so this file's own afterAll has nothing to report; the point of the assertion above
    // is that forgetting this line would cost nothing outside the run's parent directory.
    rmSync(leaked, { force: true, recursive: true });
  });
});
