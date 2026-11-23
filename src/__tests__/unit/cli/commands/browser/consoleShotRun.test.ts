/**
 * `browser console-shot`'s refusals that need no build: each one exits as a usage error before the verb makes its
 * throwaway directories or runs a child, so nothing under the state home is written.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runBrowserConsoleShot } from "../../../../../cli/commands/browser/consoleShotRun.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";

let root = "";
let home = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "console-shot-run-"));
  home = join(root, "home");
  mkdirSync(home);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/**
 * Run the verb with these flags against the test's own home.
 *
 * @param walk `--walk`
 * @param out `--out`
 * @returns the exit code
 */
function shot({ walk, out }: { walk: string | undefined; out: string | undefined }): Promise<number> {
  return runBrowserConsoleShot({
    capturedAtIso: "2026-11-21T14:00:00.000Z",
    home,
    options: { json: false, out, walk },
  });
}

describe("runBrowserConsoleShot", () => {
  it("refuses a walk no registry row names", async () => {
    expect(await shot({ out: join(home, "proof", "shot.png"), walk: "no-such-walk" })).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "visual-evidence"))).toBe(false);
  });

  it("refuses a missing --walk", async () => {
    expect(await shot({ out: join(home, "proof", "shot.png"), walk: undefined })).toBe(EXIT_USAGE);
  });

  it("refuses an --out that is not a .png", async () => {
    expect(await shot({ out: join(home, "proof", "shot.jpg"), walk: "automations-context" })).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "proof"))).toBe(false);
  });

  it("refuses an --out that exists as a directory", async () => {
    const out = join(home, "proof", "taken.png");
    mkdirSync(out, { recursive: true });
    expect(await shot({ out, walk: "automations-context" })).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "visual-evidence"))).toBe(false);
  });
});
