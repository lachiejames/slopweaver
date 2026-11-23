/*
 * `compactSource`'s crash-safety ordering: the canonical file lands before anything is unlinked, so a stop at any
 * instant leaves a superset the next run collapses, and a superseded file that will not go fails the source.
 */
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { OwnerProtectionResolver } from "../../../../corpus/bronzeProtection.js";
import { listBronzeFiles } from "../../../../corpus/bronzeStorage.js";
import { compactSource } from "../../../../corpus/compact.js";
import { readCorpusDir } from "../../../../corpus/corpusDirRead.js";
import { bronzeCompactFile, bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { canonical, home, jsonl, record, useCompactHome, writeWindow } from "./harness.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

useCompactHome();

describe("compactSource", () => {
  it("FAILS the source when a superseded file cannot be removed — the measure would otherwise be a lie", () => {
    // The canonical write must still succeed (top-level dir writable) while the unlink cannot: a nested,
    // read-only directory. Its records stay readable, so reporting a reduction would be untrue.
    writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record()] });
    const nested = join(bronzeSourceDir({ home, source: "github" }), "locked");
    mkdirSync(nested, { recursive: true });
    const stuck = join(nested, "old.jsonl");
    writeFileSync(stuck, jsonl({ records: [record({ sourceId: "#stuck", text: "stuck" })] }), "utf8");
    chmodSync(nested, 0o555);

    const compacted = compactSource({ home, protection: NO_ENTRIES, source: "github" });

    expect(compacted.isErr()).toBe(true);
    expect(unwrapErr(compacted).code).toBe("COMPACT_UNLINK_FAILED");
    expect(unwrapErr(compacted).message).toContain("could not remove superseded file");
    // No data was lost: the record is still on disk, and the canonical file holds it too.
    expect(readFileSync(stuck, "utf8")).toBe(jsonl({ records: [record({ sourceId: "#stuck", text: "stuck" })] }));
    expect(
      unwrap(readCorpusDir({ dir: bronzeSourceDir({ home, source: "github" }), home, protection: NO_ENTRIES })).records
        .length,
    ).toBe(3);
    chmodSync(nested, 0o755);
  });

  it("writes the canonical file BEFORE unlinking anything — a crash between the two leaves a superset", () => {
    // Asserted through the unlink failure, which stops the run at exactly that instant: every record is
    // still readable from the old window AND from the canonical file that already landed.
    writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record()] });
    const nested = join(bronzeSourceDir({ home, source: "github" }), "locked");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "old.jsonl"), jsonl({ records: [record({ sourceId: "#stuck" })] }), "utf8");
    chmodSync(nested, 0o555);

    compactSource({ home, protection: NO_ENTRIES, source: "github" });

    expect(canonical()).toBe(jsonl({ records: [record(), record({ sourceId: "#stuck" })] }));
    // …and the next run collapses the superset back down.
    chmodSync(nested, 0o755);
    const again = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));
    expect(again.after.records).toBe(2);
    expect(
      unwrap(listBronzeFiles({ home, protection: NO_ENTRIES, source: "github" })).map((file) => file.path),
    ).toStrictEqual([bronzeCompactFile({ home, source: "github" })]);
  });

  it("recovers a crash between rename and unlink — leftover windows are a superset, collapsed next run", () => {
    // Simulate the interrupted state directly: the canonical file landed, the old windows were not removed.
    writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record(), record({ sourceId: "#2", text: "2" })] });
    writeWindow({ name: "compact.jsonl", records: [record(), record({ sourceId: "#2", text: "2" })] });

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(plan.before.records).toBe(4);
    expect(plan.after.records).toBe(2);
    expect(readdirSync(bronzeSourceDir({ home, source: "github" }))).toStrictEqual(["compact.jsonl"]);
  });
});
