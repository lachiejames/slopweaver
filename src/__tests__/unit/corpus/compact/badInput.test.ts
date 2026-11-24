/*
 * `compactSource` over input it cannot carry forward: a line that is not JSON or a file it cannot read aborts the
 * source with nothing rewritten, while a well-formed row failing the required-field gate is skipped and counted.
 */
import { chmodSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compactSource } from "../../../../corpus/compact.js";
import { bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { canonical, home, jsonl, record, useCompactHome, writeWindow } from "./harness.js";

useCompactHome();

describe("compactSource", () => {
  it("REFUSES a source the owner's protect list marks no-access, rewriting nothing", () => {
    const path = writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record()] });
    const before = readFileSync(path, "utf8");
    const dir = bronzeSourceDir({ home, source: "github" });
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: dir, why: "fixture" };

    const refusal = unwrapErr(compactSource({ home, protection: () => ok([entry]), source: "github" }));

    expect(refusal).toStrictEqual({
      code: "COMPACT_LIST_REFUSED",
      message:
        `refusing to read github: it would search ${dir}, which the owner's protect list marks no-access at ` +
        `${dir} (fixture) — nothing was compacted`,
    });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("REFUSES a source holding a read-only window, which the listing reads but compaction would unlink", () => {
    const kept = writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record()] });
    const held = writeWindow({ name: "2026-06-08_2026-06-15.jsonl", records: [record({ sourceId: "#2" })] });
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "read-only" as const, path: held, why: "fixture" };

    const refusal = unwrapErr(compactSource({ home, protection: () => ok([entry]), source: "github" }));

    expect(refusal).toStrictEqual({
      code: "COMPACT_PROTECTED",
      message:
        `refusing to compact github: it would write to ${held}, which the owner's protect list marks read-only at ` +
        `${held} (fixture) — nothing was compacted`,
    });
    expect(readdirSync(bronzeSourceDir({ home, source: "github" })).toSorted()).toStrictEqual([
      "2026-06-01_2026-06-08.jsonl",
      "2026-06-08_2026-06-15.jsonl",
    ]);
    expect(readFileSync(kept, "utf8")).toBe(jsonl({ records: [record()] }));
  });

  it("ABORTS on a line that isn't even JSON — the file itself is suspect, not just that row", () => {
    const path = writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record()] });
    writeFileSync(path, `${readFileSync(path, "utf8")}{not json\n`, "utf8");
    const before = readFileSync(path, "utf8");

    const compacted = compactSource({ home, protection: () => ok([]), source: "github" });

    expect(compacted.isErr()).toBe(true);
    expect(unwrapErr(compacted).code).toBe("CORRUPT_LINE");
    expect(unwrapErr(compacted).message).toContain("2026-06-01_2026-06-08.jsonl:2");
    expect(unwrapErr(compacted).message).toContain("refusing to compact this source");
    // Nothing was rewritten: the window file is untouched, and no canonical or staged file was left behind.
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(readdirSync(bronzeSourceDir({ home, source: "github" }))).toStrictEqual(["2026-06-01_2026-06-08.jsonl"]);
  });

  it("SKIPS one well-formed row that fails the required-field gate, keeping every other survivor", () => {
    // A line that IS valid JSON but is missing tsIso — the exact shape of the corpus's own known
    // CODEOWNERS-derived rows — must not sink the whole source the way unparseable JSON does.
    writeWindow({
      name: "a.jsonl",
      records: [record({ sourceId: "#1" }), record({ sourceId: "#bad", tsIso: "" }), record({ sourceId: "#2" })],
    });

    const plan = unwrap(compactSource({ home, protection: () => ok([]), source: "github" }));

    expect(plan.rejected).toBe(1);
    expect(plan.after.records).toBe(2);
    expect(canonical()).toBe(jsonl({ records: [record({ sourceId: "#1" }), record({ sourceId: "#2" })] }));
    expect(plan.rejectedSamples).toHaveLength(1);
    expect(plan.rejectedSamples[0]!).toContain("a.jsonl:2");
    expect(plan.rejectedSamples[0]!).toContain("empty required field: tsIso");
  });

  it("caps rejectedSamples at MAX_REJECTED_SAMPLES while the count keeps climbing", () => {
    const bad = Array.from({ length: 25 }, (_unused, index) => record({ sourceId: `#bad${String(index)}`, text: "" }));
    writeWindow({ name: "a.jsonl", records: [record({ sourceId: "#ok" }), ...bad] });

    const plan = unwrap(compactSource({ home, protection: () => ok([]), source: "github" }));

    expect(plan.rejected).toBe(25);
    expect(plan.rejectedSamples).toHaveLength(20);
    expect(plan.after.records).toBe(1);
  });

  it("aborts a corrupt line found AFTER a full write batch has already been staged", () => {
    // The abort has to discard bytes already written to the staged file, not just bytes still in the batch.
    const wide = Array.from({ length: 800 }, (_unused, index) =>
      record({ sourceId: `#${String(index)}`, text: "x".repeat(6 * 1024) }),
    );
    const path = writeWindow({ name: "a.jsonl", records: wide });
    writeFileSync(path, `${readFileSync(path, "utf8")}{not json\n`, "utf8");

    const compacted = compactSource({ home, protection: () => ok([]), source: "github" });

    expect(compacted.isErr()).toBe(true);
    expect(unwrapErr(compacted).code).toBe("CORRUPT_LINE");
    expect(readdirSync(bronzeSourceDir({ home, source: "github" }))).toStrictEqual(["a.jsonl"]);
  });

  it("ABORTS rather than dropping the records of a window file it cannot read", () => {
    writeWindow({ name: "a.jsonl", records: [record()] });
    const unreadable = writeWindow({ name: "b.jsonl", records: [record({ sourceId: "#hidden" })] });
    chmodSync(unreadable, 0o000);

    const compacted = compactSource({ home, protection: () => ok([]), source: "github" });

    expect(compacted.isErr()).toBe(true);
    expect(unwrapErr(compacted).code).toBe("COMPACT_READ_FAILED");
    expect(readdirSync(bronzeSourceDir({ home, source: "github" })).toSorted()).toStrictEqual(["a.jsonl", "b.jsonl"]);
    chmodSync(unreadable, 0o644);
  });
});
