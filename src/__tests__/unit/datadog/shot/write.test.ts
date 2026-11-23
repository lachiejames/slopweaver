/**
 * `gradeAndCommitBytes`: the relay's PNG goes through the same grade and atomic commit a file does, and a
 * refusal leaves yesterday's good proof where it was.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { gradeAndCommitBytes } from "../../../../datadog/shot/write.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A PNG header declaring a size — only the bytes the grade reads are real. */
function pngHeader({ widthPx, heightPx }: { widthPx: number; heightPx: number }): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(widthPx, 16);
  bytes.writeUInt32BE(heightPx, 20);
  return bytes;
}

/** A fresh output directory. */
function outDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dd-shot-write-"));
  dirs.push(dir);
  return dir;
}

describe("gradeAndCommitBytes", () => {
  it("commits a graded PNG onto its path and leaves no staging file behind", () => {
    const imagePath = join(outDir(), "monitor-1-7d-backtest.png");
    const bytes = pngHeader({ heightPx: 600, widthPx: 900 });
    expect(unwrap(gradeAndCommitBytes({ bytes, imagePath }))).toStrictEqual({ heightPx: 600, widthPx: 900 });
    expect(readFileSync(imagePath).equals(bytes)).toBe(true);
    expect(existsSync(`${imagePath}.partial`)).toBe(false);
  });

  it("refuses an image with no area and leaves the proof already there untouched", () => {
    const imagePath = join(outDir(), "monitor-1-7d-backtest.png");
    writeFileSync(imagePath, "yesterday");
    const failed = unwrapErr(gradeAndCommitBytes({ bytes: pngHeader({ heightPx: 0, widthPx: 900 }), imagePath }));
    expect(failed.code).toBe("IMAGE_UNUSABLE");
    expect(readFileSync(imagePath, "utf8")).toBe("yesterday");
    expect(existsSync(`${imagePath}.partial`)).toBe(false);
  });

  it("refuses a directory that is not there as an unwritable output", () => {
    const imagePath = join(outDir(), "missing", "monitor-1-7d-backtest.png");
    expect(unwrapErr(gradeAndCommitBytes({ bytes: pngHeader({ heightPx: 1, widthPx: 1 }), imagePath })).code).toBe(
      "OUTPUT_UNWRITABLE",
    );
  });
});
