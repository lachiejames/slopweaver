/**
 * The `dev heap-curve` shell over a real temp corpus: the flag edges, and one genuine measurement whose
 * SHAPE is asserted exactly. Its ratios are not — on a fixture this small the records delta is dominated by
 * the process's own allocation noise, so a verdict on the coefficient band would be a coin toss; the band is
 * asserted against the real corpus's measured numbers in `corpusStoreProjection.test.ts` instead.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDevHeapCurveWithDeps } from "../../../../../cli/commands/dev/heapCurve.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { Logger } from "../../../../../lib/logger.js";

/** A logger that records what the verb printed, by stream. */
function captureLogger(): { log: Pick<Logger, "error" | "out" | "warn">; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return {
    errs,
    log: {
      error: ({ msg }) => {
        errs.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
      warn: ({ msg }) => {
        errs.push(msg);
      },
    },
    out,
  };
}

/** `slopweaver dev heap-curve <tail>` — the tail starts at argv index 4. */
const run = ({
  tail,
  log,
}: {
  tail: readonly string[];
  log: Pick<Logger, "error" | "out" | "warn">;
}): Promise<number> => runDevHeapCurveWithDeps({ argv: ["node", "slopweaver", "dev", "heap-curve", ...tail], log });

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-heapcurve-"));
  const dir = join(home, "corpus", "bronze", "slack");
  mkdirSync(dir, { recursive: true });
  const rows = Array.from({ length: 50 }, (_unused, i) =>
    JSON.stringify({
      container: "C1",
      kind: "message",
      refs: [],
      source: "slack",
      sourceId: `m${String(i)}`,
      text: `message number ${String(i)} about the staging pool`,
      tsIso: "2026-01-01T00:00:00Z",
      url: `https://example.invalid/${String(i)}`,
    }),
  );
  writeFileSync(join(dir, "w.jsonl"), `${rows.join("\n")}\n`, "utf8");
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("runDevHeapCurve", () => {
  it("prints usage on --help", async () => {
    const { log, out } = captureLogger();
    expect(await run({ log, tail: ["--help"] })).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver dev heap-curve");
  });

  it("refuses an unknown flag and an unknown projection as usage errors", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--nope"] })).toBe(EXIT_USAGE);
    expect(errs[0]).toContain("--nope");
    expect(await run({ log, tail: ["--home", home, "--projection", "silver"] })).toBe(EXIT_USAGE);
    expect(errs.at(-1)).toBe("--projection must be one of retrieval|bronze|derive, got silver");
  });

  it("measures a real corpus phase by phase, in the projection asked for", async () => {
    const { log, out } = captureLogger();
    await run({ log, tail: ["--home", home, "--projection", "bronze"] });
    expect(out[0]).toBe(
      `corpus: ${join(home, "corpus", "bronze")} — 1 file(s), 0 MiB on disk, 50 record(s), bronze projection`,
    );
    expect(out[2]).toBe("phase      live MiB   +delta   external MiB   at");
    expect(out.slice(3, 5).map((line) => line.split(/\s+/)[0])).toEqual(["start", "records"]);
    expect(out[5]).toMatch(/^peak live heap is \d+% of the ceiling$/);
    expect(out[6]).toMatch(/^records: [\d.]+ live bytes per disk byte — shipped band 0\.70…2\.00 /);
    // Two phases, and no more: the index and vectors rows went with the lane retired.
    expect(out).toHaveLength(7);
  });

  it("emits the curve as one JSON object under --json", async () => {
    const { log, out } = captureLogger();
    await run({ log, tail: ["--home", home, "--json"] });
    expect(out).toHaveLength(1);
    const curve: unknown = JSON.parse(out[0]!);
    expect(curve).toMatchObject({ sample: { fileCount: 1, projection: "bronze", recordCount: 50 } });
  });
});
