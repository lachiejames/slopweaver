/**
 * The temp directory every `supervisor tick` case runs in: one per case, minted before it and removed after.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach } from "vitest";

/** The case's temp directory; a live binding, assigned before each case and read only inside one. */
export let root: string;
/** The seat directory inside {@link root}; a live binding, assigned before each case and read only inside one. */
export let dir: string;

/**
 * Register the hooks that give every case its own temp directory, and remove it after. Call it once, at the top of
 * a test file.
 */
export function useWorkdir(): void {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "supervisor-tick-"));
    dir = join(root, "handoff-9292");
    mkdirSync(dir);
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });
}
