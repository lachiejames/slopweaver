/**
 * The `dev capture-conflicts` shell over a real temp corpus: the flag edges, and one genuine scan of a
 * bronze file holding the exact pair the marker tie-break decides — a truncated capture and its repair, at
 * one instant with one body.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDevCaptureConflictsWithDeps } from "../../../../../cli/commands/dev/captureConflicts.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { Logger } from "../../../../../lib/logger.js";

/** A logger that records what the verb printed, by stream. */
function captureLogger(): { log: Pick<Logger, "error" | "out">; out: string[]; errs: string[] } {
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
    },
    out,
  };
}

/** `slopweaver dev capture-conflicts <tail>` — the tail starts at argv index 4. */
const run = ({ tail, log }: { tail: readonly string[]; log: Pick<Logger, "error" | "out"> }): number =>
  runDevCaptureConflictsWithDeps({ argv: ["node", "slopweaver", "dev", "capture-conflicts", ...tail], log });

const row = ({ partial }: { partial: boolean }): string =>
  JSON.stringify({
    container: "notion",
    kind: "page",
    refs: [],
    source: "notion",
    sourceId: "page:abc:chunk:0",
    text: "the first chunk",
    tsIso: "2026-01-01T00:00:00.000Z",
    url: "https://example.invalid/x",
    ...(partial ? { attrs: { capture: "partial", chunkCount: 23 } } : { attrs: { chunkCount: 112 } }),
  });

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-capture-conflicts-"));
  const dir = join(home, "corpus", "bronze", "notion");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "2026-01-01_2026-01-02.jsonl"), `${row({ partial: true })}\n${row({ partial: false })}\n`);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("runDevCaptureConflictsWithDeps", () => {
  it("counts the truncated/repaired pair on disk as one marker-decided group", () => {
    const { log, out } = captureLogger();

    expect(run({ log, tail: ["--source", "notion", "--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe(
      "source: notion — 2 row(s), 1 declaring capture=partial, 1 distinct (identity, instant, text) group(s)",
    );
    expect(out[1]).toContain("marker tie-break: 1 group(s)");
  });

  it("emits the count as one JSON line under --json", () => {
    const { log, out } = captureLogger();

    expect(run({ log, tail: ["--source", "notion", "--home", home, "--json"] })).toBe(EXIT_OK);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toMatchObject({ decidedByMarker: 1, partialRows: 1, rows: 2, source: "notion" });
  });

  it("reports zero for a source with no bronze at all rather than failing", () => {
    const { log, out } = captureLogger();

    expect(run({ log, tail: ["--source", "linear", "--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe(
      "source: linear — 0 row(s), 0 declaring capture=partial, 0 distinct (identity, instant, text) group(s)",
    );
  });

  it("refuses a run that names no source", () => {
    const { errs, log } = captureLogger();

    expect(run({ log, tail: ["--home", home] })).toBe(EXIT_USAGE);
    expect(errs[0]).toContain("--source is required");
  });

  it("prints the usage on --help without scanning anything", () => {
    const { log, out } = captureLogger();

    expect(run({ log, tail: ["--help"] })).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver dev capture-conflicts");
  });
});
