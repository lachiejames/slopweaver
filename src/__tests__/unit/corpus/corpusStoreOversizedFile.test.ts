/**
 * Regression guard for the bronze-reader outage: a single window file holding more records than the
 * engine's spread-argument limit must still read completely.
 *
 * Kept in its own file because it is the only unit test in the corpus lane that writes a large fixture
 * (~130k lines), so its cost is visible rather than buried in an otherwise-instant suite.
 *
 * Why the fixture is this big: `readCorpusDir` used to append with `records.push(...parsed.value)`, which
 * passes every element as a separate ARGUMENT. Over the engine's argument limit that throws `RangeError:
 * Maximum call stack size exceeded`. The limit is stack-dependent rather than a spec constant — measured at
 * 123,947 on the Node 24 baseline — so the fixture must clear the highest plausible value to be falsifiable
 * at all. A bronze window file has no record ceiling, so this is a reachable state, not a synthetic one:
 * a real corpus hit it with well over a hundred thousand Slack records in one backfill window and every bronze-touching verb
 * (refresh's dedup index, derive, distil, identity, audit, retrieval) failed at once.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { readCorpusDir } from "../../../corpus/corpusDirRead.js";
import { ok, unwrap } from "../../../lib/result.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

/** Comfortably above the measured 123,947-element spread limit, so the pre-fix reader throws here. */
const OVERSIZED_RECORD_COUNT = 130_000;

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "slopweaver-oversized-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("readCorpusDir over an oversized window file", () => {
  it("reads every record from a file with more records than the spread-argument limit", () => {
    const sourceDir = join(root, "slack");
    mkdirSync(sourceDir, { recursive: true });
    const lines = Array.from({ length: OVERSIZED_RECORD_COUNT }, (_unused, index) =>
      JSON.stringify({
        container: "C1",
        kind: "message",
        refs: [],
        source: "slack",
        sourceId: `m${String(index)}`,
        text: "hi",
        tsIso: "2026-01-01T00:00:00Z",
        url: `https://example.invalid/${String(index)}`,
      }),
    );
    writeFileSync(join(sourceDir, "2026-01-01_2026-03-31.jsonl"), `${lines.join("\n")}\n`, "utf8");

    const { records } = unwrap(readCorpusDir({ dir: root, home: root, protection: NO_ENTRIES }));

    expect(records).toHaveLength(OVERSIZED_RECORD_COUNT);
    // Exact first/last, so a truncating read cannot pass on the count alone.
    expect(records[0]!.sourceId).toBe("m0");
    expect(records[OVERSIZED_RECORD_COUNT - 1]!.sourceId).toBe(`m${String(OVERSIZED_RECORD_COUNT - 1)}`);
  });

  it("prefixes a corrupt line's warning with the file path even in an oversized file", () => {
    const sourceDir = join(root, "slack");
    mkdirSync(sourceDir, { recursive: true });
    const valid = JSON.stringify({
      container: "C1",
      kind: "message",
      refs: [],
      source: "slack",
      sourceId: "m0",
      text: "hi",
      tsIso: "2026-01-01T00:00:00Z",
      url: "https://example.invalid/0",
    });
    writeFileSync(join(sourceDir, "w.jsonl"), `${valid}\nnot json at all\n`, "utf8");

    const result = unwrap(readCorpusDir({ dir: root, home: root, protection: NO_ENTRIES }));

    expect(result.records).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("w.jsonl");
  });
});
