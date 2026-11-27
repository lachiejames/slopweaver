/**
 * `supervisor tick-capture --home` naming a home other than the ambient one: the capture is confined to it, so every
 * child runs under that home, no monitor is fired and no reading that acts on the world runs. The one injected seam
 * is the child launcher (`./scratchFakes.ts`); the unconfined capture is `./scratchRun.test.ts`'s.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTickCapture } from "../../../../../cli/commands/supervisor/scratchRun.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { fakeDeps } from "./scratchFakes.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scratch-confined-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("supervisor tick-capture --home, confined", () => {
  it("confines a capture whose --home is not the ambient home: every child under it, nothing that acts", async () => {
    const fake = fakeDeps({ ambientHome: "/ambient/home" });
    const code = await runTickCapture({
      deps: fake.deps,
      rest: ["--dir", root, "--tick", "4", "--loop-session-key", "loop-a", "--home", "/scratch/home"],
    });
    expect(code).toBe(EXIT_OK);
    expect(fake.launched.length).toBeGreaterThan(0);
    expect(fake.childHomes.filter((home) => home !== "/scratch/home")).toEqual([]);
    expect(fake.launched.filter((line) => line.includes("--fire"))).toEqual([]);
    expect(fake.launched.filter((line) => line.includes(" events tail "))).toEqual([]);
    expect(fake.launched.filter((line) => line.includes(" handover wake "))).toEqual([]);
    expect(fake.launched).toContain(
      "/checkout/bin/slopweaver monitor check --only fleet-unhealthy --by-session supervisor --json",
    );
    expect(fake.out[0]).toBe(
      "CONFINED tick: every reading ran with SLOPWEAVER_HOME=/scratch/home, not the ambient /ambient/home",
    );
    expect(fake.out).toContain("withheld handover-wake: it runs a real cmux spawn for every due parked seat");
  });
});
