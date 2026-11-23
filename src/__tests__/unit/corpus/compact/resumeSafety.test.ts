/*
 * `compactCorpus` over several sources: a compacted corpus leaves every resume cursor byte-identical and still
 * refreshes from it, a failed source is named rather than hidden, and the reader and the compactor agree on what
 * bronze holds.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { OwnerProtectionResolver } from "../../../../corpus/bronzeProtection.js";
import { listBronzeFiles } from "../../../../corpus/bronzeStorage.js";
import { compactSource } from "../../../../corpus/compact.js";
import { compactCorpus } from "../../../../corpus/compactCorpus.js";
import { readCorpusDir } from "../../../../corpus/corpusDirRead.js";
import { bronzeSourceDir, githubReposWatermarkPath, sourceWatermarkPath } from "../../../../corpus/corpusPaths.js";
import { writeCorpusRecords } from "../../../../corpus/corpusWriter.js";
import type { ExportWindow } from "../../../../corpus/types.js";
import { advanceWatermark, readWatermark, resolveSince } from "../../../../corpus/watermark.js";
import { ok, unwrap } from "../../../../lib/result.js";
import { home, jsonl, record, useCompactHome, writeWindow } from "./harness.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

useCompactHome();

describe("compactCorpus resume safety", () => {
  const window: ExportWindow = { since: "2026-06-01", until: "2026-06-08" };

  it("leaves every resume cursor byte-identical, and a later refresh still resumes from it", () => {
    // A real ingest: the writer lays down bronze AND the per-source watermark, exactly as refresh does.
    writeCorpusRecords({
      home,
      protection: NO_ENTRIES,
      records: [record({ tsIso: "2026-06-07T10:00:00.000Z" })],
      window,
    });
    advanceWatermark({ home, watermarks: [{ cursor: "2026-06-07T10:00:00.000Z", source: "github" }] });
    mkdirSync(join(home, "corpus"), { recursive: true });
    writeFileSync(
      githubReposWatermarkPath({ home }),
      `${JSON.stringify({ repos: { "o/r": "2026-06-07" } })}\n`,
      "utf8",
    );
    writeFileSync(join(home, "corpus", ".slack-threads.json"), `${JSON.stringify({ "c:1.0": "9.9" })}\n`, "utf8");
    // A second, overlapping window arrives out of band (the case per-write dedup can't collapse).
    writeWindow({ name: "2026-06-05_2026-06-12.jsonl", records: [record({ tsIso: "2026-06-07T10:00:00.000Z" })] });

    const cursorBefore = readFileSync(sourceWatermarkPath({ home, source: "github" }), "utf8");
    const reposBefore = readFileSync(githubReposWatermarkPath({ home }), "utf8");
    const threadsBefore = readFileSync(join(home, "corpus", ".slack-threads.json"), "utf8");

    const run = unwrap(compactCorpus({ home, protection: NO_ENTRIES }));

    expect(run.plans.map((plan) => plan.source)).toStrictEqual([
      "github",
      "slack",
      "linear",
      "notion",
      "self",
      "gmail",
      "calendar",
      "fathom",
      "chatgpt",
      "outlook-calendar",
    ]);
    expect(run.plans.find((plan) => plan.source === "github")!.duplicatesCollapsed).toBe(1);
    expect(readFileSync(sourceWatermarkPath({ home, source: "github" }), "utf8")).toBe(cursorBefore);
    expect(readFileSync(githubReposWatermarkPath({ home }), "utf8")).toBe(reposBefore);
    expect(readFileSync(join(home, "corpus", ".slack-threads.json"), "utf8")).toBe(threadsBefore);
    // The next refresh reads the same cursor and would ask for the same window.
    expect(readWatermark({ home, source: "github" })).toBe("2026-06-07T10:00:00.000Z");
    expect(resolveSince({ cursor: readWatermark({ home, source: "github" }), fallbackSince: "2000-01-01" })).toBe(
      "2026-06-07",
    );
  });

  it("a refresh after compaction still dedups against the canonical file (no re-write of known records)", () => {
    writeCorpusRecords({ home, protection: NO_ENTRIES, records: [record()], window });
    compactSource({ home, protection: NO_ENTRIES, source: "github" });

    const again = writeCorpusRecords({ home, protection: NO_ENTRIES, records: [record()], window });

    expect(unwrap(again).written).toBe(0);
    expect(unwrap(again).deduped).toBe(1);
  });

  it("skips a source with no bronze on disk", () => {
    writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record()] });
    const run = unwrap(compactCorpus({ home, protection: NO_ENTRIES, sources: ["github", "slack"] }));
    expect(run.plans.map((plan) => plan.source)).toStrictEqual(["github", "slack"]);
    expect(run.plans[1]!.before).toStrictEqual({ bytes: 0, files: 0, records: 0 });
    expect(run.failed).toStrictEqual([]);
    expect(unwrap(listBronzeFiles({ home, protection: NO_ENTRIES, source: "slack" }))).toStrictEqual([]);
  });

  it("warns about a rejected row without failing the source — the run still succeeds", () => {
    writeWindow({ name: "a.jsonl", records: [record({ sourceId: "#1" }), record({ sourceId: "#bad", text: "" })] });

    const run = unwrap(compactCorpus({ home, protection: NO_ENTRIES, sources: ["github"] }));

    expect(run.failed).toStrictEqual([]);
    expect(run.plans[0]!.rejected).toBe(1);
    expect(run.warnings).toHaveLength(1);
    expect(run.warnings[0]!).toContain("github: 1 row(s) rejected");
  });

  it("names a source that FAILED so a partial run is never presented as a clean one", () => {
    writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record()] });
    const broken = join(bronzeSourceDir({ home, source: "slack" }), "2026-06-01_2026-06-08.jsonl");
    mkdirSync(bronzeSourceDir({ home, source: "slack" }), { recursive: true });
    writeFileSync(broken, "{not json\n", "utf8");

    const run = unwrap(compactCorpus({ home, protection: NO_ENTRIES, sources: ["github", "slack"] }));

    expect(run.failed).toStrictEqual(["slack"]);
    expect(run.plans.map((plan) => plan.source)).toStrictEqual(["github"]);
    expect(readFileSync(broken, "utf8")).toBe("{not json\n");
  });

  it("folds a NESTED bronze file in, so the reader and the compactor never disagree", () => {
    // `readCorpusDir` recurses, so a record in a nested file IS in the corpus; the compactor must see it too.
    writeWindow({ name: "2026-06-01_2026-06-08.jsonl", records: [record()] });
    const nested = join(bronzeSourceDir({ home, source: "github" }), "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(nested, "old.jsonl"),
      jsonl({ records: [record(), record({ sourceId: "#deep", text: "deep" })] }),
      "utf8",
    );

    const plan = unwrap(compactSource({ home, protection: NO_ENTRIES, source: "github" }));

    expect(plan.before.records).toBe(3);
    expect(plan.after.records).toBe(2);
    expect(
      unwrap(
        readCorpusDir({ dir: bronzeSourceDir({ home, source: "github" }), home, protection: NO_ENTRIES }),
      ).records.map((r) => r.sourceId),
    ).toStrictEqual(["#1", "#deep"]);
  });
});
