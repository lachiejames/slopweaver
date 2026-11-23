/*
 * `compactSource` merging a source's window files into one canonical file: the exact before/after counts, which records
 * collapse and which survive, the bytes a rewrite carries through, a second pass and a later window, and a source
 * nothing ever wrote.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OwnerProtectionResolver } from "../../../../corpus/bronzeProtection.js";
import { compactSource } from "../../../../corpus/compact.js";
import { readCorpusDir } from "../../../../corpus/corpusDirRead.js";
import { bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { ok, unwrap } from "../../../../lib/result.js";
import { canonical, home, jsonl, record, useCompactHome, writeWindow } from "./harness.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

useCompactHome();

describe("compactSource", () => {
  it("collapses records shared by two overlapping windows into one canonical file, losing no unique record", () => {
    const shared = [record({ sourceId: "#1" }), record({ sourceId: "#2", text: "two" })];
    writeWindow({ name: "a.jsonl", records: [...shared, record({ sourceId: "#3", text: "only-early" })] });
    writeWindow({ name: "b.jsonl", records: [...shared, record({ sourceId: "#4", text: "only-late" })] });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(plan.before.records).toBe(6);
    expect(plan.after.records).toBe(4);
    expect(plan.duplicatesCollapsed).toBe(2);
    expect(plan.pruned).toBe(0);
    expect(plan.before.files).toBe(2);
    expect(plan.after.files).toBe(1);
    expect(canonical()).toBe(
      jsonl({
        records: [
          record({ sourceId: "#1" }),
          record({ sourceId: "#2", text: "two" }),
          record({ sourceId: "#3", text: "only-early" }),
          record({ sourceId: "#4", text: "only-late" }),
        ],
      }),
    );
    expect(plan.supersededPaths).toStrictEqual([
      join(bronzeSourceDir({ home, source: "github" }), "a.jsonl"),
      join(bronzeSourceDir({ home, source: "github" }), "b.jsonl"),
    ]);
    expect(plan.after.bytes).toBeLessThan(plan.before.bytes);
  });

  it("reports after.bytes as the canonical file's real size on disk", () => {
    writeWindow({ name: "a.jsonl", records: [record(), record({ sourceId: "#2", text: "two" })] });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(plan.after.bytes).toBe(Buffer.byteLength(canonical(), "utf8"));
    expect(plan.before.bytes).toBe(plan.after.bytes);
  });

  it("keeps a superseded VERSION of the same sourceId — different content is history, not a duplicate", () => {
    writeWindow({ name: "a.jsonl", records: [record({ text: "v1", tsIso: "2026-06-01T00:00:00.000Z" })] });
    writeWindow({ name: "b.jsonl", records: [record({ text: "v2", tsIso: "2026-06-02T00:00:00.000Z" })] });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(plan.after.records).toBe(2);
    expect(plan.duplicatesCollapsed).toBe(0);
  });

  it("collapses the same content captured at DIFFERENT times (the writer's tsIso-blind fingerprint)", () => {
    writeWindow({ name: "a.jsonl", records: [record({ tsIso: "2026-06-01T00:00:00.000Z" })] });
    writeWindow({ name: "b.jsonl", records: [record({ tsIso: "2026-06-09T00:00:00.000Z" })] });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(plan.after.records).toBe(1);
    expect(plan.duplicatesCollapsed).toBe(1);
    expect(canonical()).toBe(jsonl({ records: [record({ tsIso: "2026-06-01T00:00:00.000Z" })] }));
  });

  it("merges two overlapping window files on disk into one canonical file readable end to end", () => {
    const shared = record({ sourceId: "#dup" });
    writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [shared, record({ sourceId: "#a", text: "a" })] });
    writeWindow({ name: "2026-06-05_2026-06-12.jsonl", records: [shared, record({ sourceId: "#b", text: "b" })] });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(plan.before.records).toBe(4);
    expect(plan.after.records).toBe(3);
    expect(readdirSync(bronzeSourceDir({ home, source: "github" }))).toStrictEqual(["compact.jsonl"]);
    const back = unwrap(
      readCorpusDir({ dir: bronzeSourceDir({ home, source: "github" }), home, protection: NO_ENTRIES }),
    );
    expect(back.records.map((r) => r.sourceId).toSorted()).toStrictEqual(["#a", "#b", "#dup"]);
  });

  it("carries a record's whole `raw` payload through the rewrite, byte for byte", () => {
    // The rewrite serialises what it parsed, so a projection that dropped `raw` would silently strip the
    // source payload off every row in the corpus.
    const withRaw = record({ raw: { deep: { nested: [1, "two"] } }, sourceId: "#raw" });
    writeWindow({ name: "a.jsonl", records: [withRaw] });

    unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(canonical()).toBe(jsonl({ records: [withRaw] }));
  });

  it("writes identical bytes whether the survivors fill one write batch or many", () => {
    // The batching flush is the only thing between the reader and the file, so a record straddling a batch
    // boundary must produce the same file as one that does not. A 6 KiB text field puts ~700 records well
    // past the 4 MiB batch.
    const wide = Array.from({ length: 800 }, (_unused, index) =>
      record({ sourceId: `#${String(index)}`, text: "x".repeat(6 * 1024) }),
    );
    writeWindow({ name: "a.jsonl", records: wide });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(plan.after.records).toBe(800);
    expect(canonical()).toBe(jsonl({ records: wide }));
  });

  it("is idempotent — a second pass over an already-canonical corpus changes nothing", () => {
    writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record(), record({ sourceId: "#2" })] });
    const first = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));
    const bytes = canonical();

    const second = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(second.duplicatesCollapsed).toBe(0);
    expect(second.after.records).toBe(first.after.records);
    expect(canonical()).toBe(bytes);
  });

  it("folds a NEW window written after compaction back into the canonical file", () => {
    writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record()] });
    compactSource({ home, protection: NO_ENTRIES, source: "github" });
    writeWindow({ name: "2026-06-08_2026-06-15.jsonl", records: [record({ sourceId: "#later", text: "later" })] });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(plan.before.files).toBe(2);
    expect(plan.after.records).toBe(2);
    expect(readdirSync(bronzeSourceDir({ home, source: "github" }))).toStrictEqual(["compact.jsonl"]);
  });

  it("touches nothing at all for a source that was never ingested", () => {
    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "slack" }));

    expect(plan.before).toStrictEqual({ bytes: 0, files: 0, records: 0 });
    expect(plan.after).toStrictEqual({ bytes: 0, files: 0, records: 0 });
    expect(plan.supersededPaths).toStrictEqual([]);
    expect(readdirSync(home)).toStrictEqual([]);
  });
});
