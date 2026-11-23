/**
 * {@link composeGoldenProof} exercised as a genuine fixture round-trip (per `testing.md`): two tiny real
 * PNGs are written to a temp dir, composed, and the result read back and asserted on — no mocking of
 * `jimp` itself, since the whole point is proving the real compositor produces a real, readable file.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrapErr } from "../../../../lib/result.js";
import { composeGoldenProof } from "../../../../proof/yarnWhy/compose.js";
import { yarnWhyErrorLines } from "../../../../proof/yarnWhy/errors.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "golden-proof-compose-test-"));
});

afterEach(() => {
  rmSync(workDir, { force: true, recursive: true });
});

/** Write a tiny fixture screenshot: a dark background with a small lighter block of "content" at the top. */
async function writeFixtureShot({ path }: { path: string }): Promise<void> {
  const image = new Jimp({ color: 0x1a1c22ff, height: 60, width: 100 });
  image.scan(0, 0, 100, 10, function paint(this: typeof image, _x, _y, idx) {
    this.bitmap.data.writeUInt32BE(0xeeeeeeff, idx);
  });
  await image.write(path as `${string}.png`);
}

describe("composeGoldenProof", () => {
  it("writes a real composed PNG wider than either single pane, and taller than either single screenshot", async () => {
    const beforePng = join(workDir, "before.png");
    const afterPng = join(workDir, "after.png");
    await writeFixtureShot({ path: beforePng });
    await writeFixtureShot({ path: afterPng });
    const outPath = join(workDir, "golden-proof.png");

    const result = await composeGoldenProof({
      after: { imagePath: afterPng, label: "after", resolved: "left-pad@npm:1.3.0" },
      before: { imagePath: beforePng, label: "before", resolved: "not present" },
      dependency: "left-pad",
      outPath,
    });

    expect(result.isOk()).toBe(true);
    expect(existsSync(outPath)).toBe(true);

    const composed = await Jimp.read(outPath);
    expect(composed.width).toBeGreaterThan(100);
    expect(composed.height).toBeGreaterThan(60);
  });

  it("reports a failure rather than throwing when a pane image does not exist", async () => {
    const result = await composeGoldenProof({
      after: { imagePath: join(workDir, "missing.png"), label: "after", resolved: "x" },
      before: { imagePath: join(workDir, "also-missing.png"), label: "before", resolved: "y" },
      dependency: "left-pad",
      outPath: join(workDir, "out.png"),
    });

    expect(unwrapErr(result).code).toBe("COMPOSE_FAILED");
    expect(yarnWhyErrorLines({ error: unwrapErr(result) })).toEqual([
      `golden-proof compose failed: Could not load Buffer from URL: ${join(workDir, "also-missing.png")}`,
    ]);
  });
});
