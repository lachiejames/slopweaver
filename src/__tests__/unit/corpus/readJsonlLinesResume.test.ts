/**
 * `readJsonlLines`'s resume seam: starting somewhere other than the beginning.
 *
 * A genuine fixture round-trip rather than a mock — the subject IS the file reading, so a fake would test
 * nothing. Each case writes a small file into the per-file temp sandbox and reads it back.
 *
 * One documented quirk shows up here rather than being discovered later: the reader mirrors `split("\n")`,
 * so a file ending in a newline yields a final EMPTY line. A read that starts at end-of-file therefore
 * reports that one blank slice rather than nothing at all. Ingest is unaffected — it skips blank lines and
 * clamps its cursor to the file size, so a whole pass still terminates — but a caller counting lines would
 * be off by one if it did not know.
 *
 * The property that matters is that a resumed read and a whole read AGREE: every byte range is absolute in
 * the file, so a line's offset means the same thing whichever read reported it. A reader whose offsets were
 * relative to its own start would look correct in isolation and put a citation on the wrong row.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readJsonlLines } from "../../../corpus/corpusStore.js";

/** Every temp directory this file minted, removed after each test. */
const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Write a file of the given lines and return its path. */
function fileOf({ lines }: { lines: readonly string[] }): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-resume-"));
  made.push(dir);
  const path = join(dir, "rows.jsonl");
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

/** Read a file from an offset and collect what each line reported. */
function linesFrom({
  path,
  startByteOffset,
}: {
  path: string;
  startByteOffset?: number;
}): readonly { line: string; byteOffset: number; index: number }[] {
  const seen: { line: string; byteOffset: number; index: number }[] = [];
  readJsonlLines({
    onLine: ({ line, byteOffset, index }) => {
      seen.push({ byteOffset, index, line });
    },
    path,
    ...(startByteOffset === undefined ? {} : { startByteOffset }),
  });
  return seen;
}

describe("a read that starts at an offset", () => {
  it("reads the whole file when given none", () => {
    const path = fileOf({ lines: ["alpha", "beta", "gamma"] });
    expect(linesFrom({ path }).map((seen) => seen.line)).toEqual(["alpha", "beta", "gamma", ""]);
  });

  it("skips exactly what came before the offset", () => {
    const path = fileOf({ lines: ["alpha", "beta", "gamma"] });
    // "alpha\n" is six bytes, so the second line begins at six.
    expect(linesFrom({ path, startByteOffset: 6 }).map((seen) => seen.line)).toEqual(["beta", "gamma", ""]);
  });

  it("reports byte offsets that stay ABSOLUTE in the file, not relative to the start", () => {
    const path = fileOf({ lines: ["alpha", "beta", "gamma"] });
    const resumed = linesFrom({ path, startByteOffset: 6 });
    expect(resumed[0]?.byteOffset).toBe(6);
  });

  it("agrees with a whole read about where every line sits", () => {
    const path = fileOf({ lines: ["alpha", "beta", "gamma"] });
    const whole = linesFrom({ path }).filter((seen) => seen.byteOffset >= 6);
    const resumed = linesFrom({ path, startByteOffset: 6 });
    expect(resumed.map((seen) => seen.byteOffset)).toEqual(whole.map((seen) => seen.byteOffset));
  });

  it("reads no CONTENT at the end of the file, only the trailing empty slice split() also yields", () => {
    const path = fileOf({ lines: ["alpha"] });
    expect(linesFrom({ path, startByteOffset: 6 }).map((seen) => seen.line)).toEqual([""]);
  });

  it("reads no content past the end either, rather than failing", () => {
    const path = fileOf({ lines: ["alpha"] });
    expect(linesFrom({ path, startByteOffset: 9999 }).map((seen) => seen.line)).toEqual([""]);
  });

  it("yields that empty slice at the offset it was asked to start from", () => {
    const path = fileOf({ lines: ["alpha"] });
    expect(linesFrom({ path, startByteOffset: 6 })[0]?.byteOffset).toBe(6);
  });

  it("numbers a resumed read's lines from zero, since an index is per-read", () => {
    const path = fileOf({ lines: ["alpha", "beta", "gamma"] });
    expect(linesFrom({ path, startByteOffset: 6 })[0]?.index).toBe(0);
  });

  it("crosses a chunk boundary without losing or repeating a line", () => {
    // 40,000 lines of ~12 bytes is comfortably past the 8 MiB chunk the reader uses only once, but the
    // carry/window seam runs on every buffer, and an off-by-one there shows up as a lost or split line.
    const lines = Array.from({ length: 40000 }, (_unused, at) => `{"n":${String(at)}}`);
    const path = fileOf({ lines });
    const whole = linesFrom({ path }).filter((seen) => seen.line.length > 0);
    expect(whole.length).toBe(40000);
    const midway = whole[20000]!;
    const resumed = linesFrom({ path, startByteOffset: midway.byteOffset }).filter((seen) => seen.line.length > 0);
    expect(resumed.length).toBe(20000);
    expect(resumed[0]?.line).toBe(midway.line);
  });
});
