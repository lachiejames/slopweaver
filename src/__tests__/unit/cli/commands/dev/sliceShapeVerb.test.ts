/**
 * `slopweaver dev slice-shape` end to end over a real bronze tree on disk.
 *
 * This is the behavioural probe for the fast-feedback-loop run: the owner's `SLICE = MEASURE` ruling asked
 * for the four candidate slices PRICED, and the thing that would silently stop being true is not the
 * arithmetic ({@link ../../../corpus/sliceShape.test} covers that) but the VERB — a section dropped, a
 * stage renamed, a corpus reader that stops finding bronze. So this drives the shipped entry point over
 * files it wrote itself and asserts all four shapes still come out with numbers behind them.
 *
 * It sits in the UNIT lane, not the subprocess one, because it meets that lane's contract exactly: it mocks
 * nothing, reaches no service, spawns no process and reads no real clock — the clock is injected — and its
 * only I/O is a `mkdtempSync` fixture written and read back, which `testing.md` names as the allowed shape.
 * The subprocess lane is for tests that need a real child process, and this needs none.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDevSliceShapeWithDeps } from "../../../../../cli/commands/dev/sliceShape.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { OwnerProtectionResolver } from "../../../../../corpus/bronzeProtection.js";
import { ok } from "../../../../../lib/result.js";
import { NO_PROTECTION } from "../../../../noProtection.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-slice-shape-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One bronze line, spelled the way a connector writes it. */
function line({
  sourceId,
  tsIso,
  container,
  source = "slack",
}: {
  sourceId: string;
  tsIso: string;
  container: string;
  source?: string;
}): string {
  return JSON.stringify({ container, kind: "message", refs: [], source, sourceId, text: "x", tsIso, url: "u" });
}

/** Write a bronze source file under the fixture home. */
function writeBronze({ source, lines }: { source: string; lines: readonly string[] }): void {
  const dir = join(home, "corpus", "bronze", source);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "compact.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

/** Run the verb, collecting what it wrote to each sink; the protect list is empty unless a test names one. */
function run({
  rest,
  nowIso,
  protection = NO_PROTECTION,
}: {
  rest: readonly string[];
  nowIso: string;
  protection?: OwnerProtectionResolver;
}): {
  code: number;
  out: string[];
  errors: string[];
} {
  const out: string[] = [];
  const errors: string[] = [];
  const code = runDevSliceShapeWithDeps({
    protection,
    argv: ["node", "cli", "dev", "slice-shape", "--home", home, ...rest],
    log: {
      error: ({ msg }) => {
        errors.push(msg);
      },
      out: ({ line: written }) => {
        out.push(written);
      },
    },
    now: new Date(nowIso),
  });
  return { code, errors, out };
}

describe("dev slice-shape over a real bronze tree", () => {
  beforeEach(() => {
    writeBronze({
      lines: [
        line({ container: "slack/C1", sourceId: "C1:1.0", tsIso: "2026-09-04T00:00:00.000Z" }),
        line({ container: "slack/C1", sourceId: "C1:1.0:reply:2.0", tsIso: "2026-09-04T01:00:00.000Z" }),
        line({ container: "slack/C1", sourceId: "C1:3.0", tsIso: "2026-09-05T00:00:00.000Z" }),
        line({ container: "slack/C2", sourceId: "C2:1.0", tsIso: "2025-02-01T00:00:00.000Z" }),
      ],
      source: "slack",
    });
    writeBronze({
      lines: [
        line({ container: "o/r", source: "github", sourceId: "o/r#1", tsIso: "2026-09-01T00:00:00.000Z" }),
        line({ container: "o/r", source: "github", sourceId: "o/r#2", tsIso: "2024-06-01T00:00:00.000Z" }),
      ],
      source: "github",
    });
  });

  it("prices all four candidate slices in one pass", () => {
    const { code, out } = run({ nowIso: "2026-09-06T00:00:00.000Z", rest: [] });
    expect(code).toBe(EXIT_OK);
    expect(out.filter((entry) => entry.startsWith("SHAPE ")).length).toBe(4);
  });

  it("counts every row it was given, across sources", () => {
    const { out } = run({ nowIso: "2026-09-06T00:00:00.000Z", rest: [] });
    expect(out[0]).toBe("slice-shape: 6 records, 864 B on disk");
  });

  it("prices a window off the days the records actually fall on", () => {
    const { out } = run({ nowIso: "2026-09-06T00:00:00.000Z", rest: [] });
    // 7 days back from the clock reaches into the prior month: the three Slack rows of the clock's month and the GitHub row on its first day.
    const week = out.find((entry) => entry.includes("--days   7"))!;
    expect(week).toContain("4 rec");
    // 365 days back reaches the same day a year earlier, which excludes the two older rows.
    const year = out.find((entry) => entry.includes("--days 365"))!;
    expect(year).toContain("4 rec");
  });

  it("collapses a Slack thread onto its root in the sample reading", () => {
    const { out } = run({ nowIso: "2026-09-06T00:00:00.000Z", rest: [] });
    const threads = out.find((entry) => entry.includes("threads · mean"))!;
    expect(threads).toContain("3 threads");
  });

  it("names the containers an allowlist would name", () => {
    const { out } = run({ nowIso: "2026-09-06T00:00:00.000Z", rest: [] });
    expect(out.some((entry) => entry.includes("slack/C1") && entry.includes("3 rec"))).toBe(true);
    expect(out.some((entry) => entry.includes("3 containers hold every container-scoped record"))).toBe(true);
  });

  it("emits the whole reading as one JSON object under --json", () => {
    const { code, out } = run({ nowIso: "2026-09-06T00:00:00.000Z", rest: ["--json"] });
    expect(code).toBe(EXIT_OK);
    const report = JSON.parse(out[0]!) as {
      fileCount: number;
      unparsedRows: number;
      shape: { totalRecords: number; windows: readonly { days: number }[] };
    };
    expect(report.fileCount).toBe(2);
    expect(report.unparsedRows).toBe(0);
    expect(report.shape.totalRecords).toBe(6);
    expect(report.shape.windows.map((entry) => entry.days)).toStrictEqual([7, 14, 30, 60, 90, 180, 365]);
  });

  it("counts a malformed line rather than aborting the census", () => {
    writeBronze({
      lines: [line({ container: "slack/C1", sourceId: "C1:9.0", tsIso: "2026-09-05T00:00:00.000Z" }), "{not json"],
      source: "slack",
    });
    const { code, out } = run({ nowIso: "2026-09-06T00:00:00.000Z", rest: ["--json"] });
    expect(code).toBe(EXIT_OK);
    const report = JSON.parse(out[0]!) as { unparsedRows: number; shape: { totalRecords: number } };
    expect(report.unparsedRows).toBe(1);
    expect(report.shape.totalRecords).toBe(3);
  });

  it("names how many containers to print through --top", () => {
    const { out } = run({ nowIso: "2026-09-06T00:00:00.000Z", rest: ["--top", "1"] });
    expect(out.filter((entry) => /^ {2}(?:slack\/C|o\/r)/.test(entry)).length).toBe(1);
  });

  it("refuses a flag it does not have", () => {
    expect(run({ nowIso: "2026-09-06T00:00:00.000Z", rest: ["--nope"] }).code).toBe(EXIT_USAGE);
  });

  it("names a source the protect list kept out of the walk on stderr, and measures the rest", () => {
    const held = join(home, "corpus", "bronze", "github");
    const protection: OwnerProtectionResolver = () =>
      ok([{ addedIso: "2026-11-01T00:00:00.000Z", mode: "no-access", path: held, why: "never read" }]);
    const { code, errors, out } = run({ nowIso: "2026-09-06T00:00:00.000Z", protection, rest: ["--json"] });
    expect(code).toBe(EXIT_OK);
    expect(errors).toEqual([`NOT READ, protected by the owner's list: ${held} [no-access]`]);
    const report = JSON.parse(out[0]!) as { fileCount: number; shape: { totalRecords: number } };
    expect(report.fileCount).toBe(1);
    expect(report.shape.totalRecords).toBe(4);
  });
});

describe("dev slice-shape with nothing to read", () => {
  it("says the corpus is empty rather than reporting zeros as a measurement", () => {
    const { code, errors } = run({ nowIso: "2026-09-06T00:00:00.000Z", rest: [] });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(errors[0]).toContain("nothing to measure");
  });
});
